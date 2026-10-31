%%%-------------------------------------------------------------------
%%% @doc Sovereign Circuit Fabric — console exchange (gen_server).
%%%
%%% Holds the fabric-level state of the Phase I console: links,
%%% tariffs, the ledger, the transcript, and one record per circuit.
%%% Every circuit lifecycle transition is executed by a real
%%% circuit_actor gen_statem process; this server is the
%%% orchestration layer the actor's own comments describe — it
%%% computes admission decisions, performs link reservation, posts
%%% accounting events, and exercises the frame codec. Packet
%%% forwarding stays outside BEAM.
%%%
%%% Commands carry transaction ids. Re-applying a transaction id
%%% returns the recorded result without reserving twice or posting
%%% the same accounting event again.
%%%-------------------------------------------------------------------
-module(scf_exchange).
-behaviour(gen_server).

-export([start_link/0, dispatch/1, snapshot/0]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

-define(INT64_MAX, 9223372036854775807).

%%%-------------------------------------------------------------------
%%% API
%%%-------------------------------------------------------------------

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

%% Cmd is a map with type and tx_id plus command fields.
%% Returns {Ok, Replay, Detail}.
dispatch(Cmd) ->
    gen_server:call(?MODULE, {apply, Cmd}).

%% Model view for rendering and tests. Actor pids are stripped.
snapshot() ->
    gen_server:call(?MODULE, snapshot).

%%%-------------------------------------------------------------------
%%% gen_server callbacks
%%%-------------------------------------------------------------------

init([]) ->
    {ok, initial_state()}.

handle_call({apply, Cmd}, _From, State) ->
    {Next, Result} = apply_cmd(State, Cmd),
    {reply, Result, Next};
handle_call(snapshot, _From, State) ->
    {reply, view(State), State};
handle_call(_Other, _From, State) ->
    {reply, {error, unknown_call}, State}.

handle_cast(_Msg, State) -> {noreply, State}.
handle_info(_Msg, State) -> {noreply, State}.

terminate(_Reason, State) ->
    kill_actors(State),
    ok.

code_change(_Old, State, _Extra) -> {ok, State}.

%%%-------------------------------------------------------------------
%%% State
%%%-------------------------------------------------------------------

initial_state() ->
    #{seconds => 0,
      next_id => 1,
      next_tx => 1,
      links => scf_model:initial_links(),
      tariffs => scf_model:initial_tariffs(),
      circuits => #{},
      order => [],
      ledger => [],
      transcript => [#{tx_id => "boot", second => 0,
                       command => "exchange boot", result => "ok",
                       detail => "Reference topology loaded. Capacities are chosen so exhaustion is observable. They are not measured hardware."}],
      applied => #{},
      last_frame => none}.

view(State) ->
    Circuits = [strip(maps:get(Id, maps:get(circuits, State)))
                || Id <- maps:get(order, State)],
    State#{circuits => Circuits}.

strip(C) -> maps:remove(pid, C).

kill_actors(State) ->
    maps:foreach(
      fun (_Id, C) ->
              Pid = maps:get(pid, C),
              case is_pid(Pid) andalso is_process_alive(Pid) of
                  true -> unlink(Pid), exit(Pid, kill);
                  false -> ok
              end
      end, maps:get(circuits, State)).

get_circuit(State, Id) ->
    case maps:find(Id, maps:get(circuits, State)) of
        {ok, C} -> {ok, C};
        error -> none
    end.

put_circuit(State, C) ->
    Circuits = maps:get(circuits, State),
    State#{circuits := Circuits#{maps:get(id, C) => C}}.

push_ledger(State, Event) ->
    State#{ledger := maps:get(ledger, State) ++ [Event]}.

%%%-------------------------------------------------------------------
%%% Command application: idempotency, transcript, tx counter
%%%-------------------------------------------------------------------

apply_cmd(State, Cmd) ->
    TxId = maps:get(tx_id, Cmd),
    case maps:find(TxId, maps:get(applied, State)) of
        {ok, {Ok, Detail}} ->
            Line = #{tx_id => TxId, second => maps:get(seconds, State),
                     command => "replay", result => "replay",
                     detail => "Idempotent. Prior result kept: " ++ Detail},
            {note(State, Line), {Ok, true, Detail}};
        error ->
            route(State, Cmd)
    end.

route(State, Cmd) ->
    Label = cmd_label(Cmd),
    case maps:get(type, Cmd) of
        reset -> do_reset(State, Cmd, Label);
        pricing_vector -> do_pricing_vector(State, Cmd, Label);
        revise_tariff -> do_revise_tariff(State, Cmd, Label);
        tick -> do_tick(State, Cmd, Label);
        fail_link -> do_fail_link(State, Cmd, Label);
        restore_link -> do_restore_link(State, Cmd, Label);
        create -> do_create(State, Cmd, Label);
        inject -> do_inject(State, Cmd, Label);
        _ -> do_transition(State, Cmd, Label)
    end.

finish(State, TxId, Label, Ok, Detail) ->
    Bumped = bump_tx(State, TxId),
    Line = #{tx_id => TxId, second => maps:get(seconds, Bumped),
             command => Label,
             result => case Ok of true -> "ok"; false -> "error" end,
             detail => Detail},
    Noted = note(Bumped, Line),
    Applied = maps:get(applied, Noted),
    {Noted#{applied := Applied#{TxId => {Ok, Detail}}}, {Ok, false, Detail}}.

note(State, Line) ->
    Transcript = maps:get(transcript, State) ++ [Line],
    Trimmed = case length(Transcript) > 120 of
                  true -> lists:nthtail(length(Transcript) - 120, Transcript);
                  false -> Transcript
              end,
    State#{transcript := Trimmed}.

bump_tx(State, TxId) ->
    case parse_tx(TxId) of
        {ok, N} ->
            Next = max(maps:get(next_tx, State), N + 1),
            State#{next_tx := Next};
        error ->
            State
    end.

parse_tx("tx-" ++ Digits) ->
    case string:to_integer(Digits) of
        {N, ""} when N >= 0 -> {ok, N};
        _ -> error
    end;
parse_tx(_) ->
    error.

illegal(State, Cmd, Label, CircuitState) ->
    finish(State, maps:get(tx_id, Cmd), Label, false,
           "Illegal transition from " ++ CircuitState ++ ".").

require_circuit(State, Cmd, Label) ->
    Id = maps:get(cid, Cmd),
    case get_circuit(State, Id) of
        {ok, C} -> {ok, C};
        none ->
            {done, finish(State, maps:get(tx_id, Cmd), Label, false,
                          "Unknown circuit " ++ integer_to_list(Id) ++ ".")}
    end.

cmd_label(Cmd) ->
    case maps:get(type, Cmd) of
        create ->
            lists:flatten(io_lib:format(
                "create ~ts ~ts ~B p~B q~B t~B",
                [maps:get(src, Cmd), maps:get(dst, Cmd), maps:get(bps, Cmd),
                 maps:get(priority, Cmd), maps:get(qos, Cmd),
                 maps:get(tariff_id, Cmd)]));
        request -> "request " ++ int(maps:get(cid, Cmd));
        admit -> "admit " ++ int(maps:get(cid, Cmd));
        reject -> "reject " ++ int(maps:get(cid, Cmd));
        timeout -> "timeout " ++ int(maps:get(cid, Cmd));
        reserve -> "reserve " ++ int(maps:get(cid, Cmd));
        install ->
            case maps:find(fault_hop, Cmd) of
                {ok, H} -> "install " ++ int(maps:get(cid, Cmd)) ++
                           " fault-hop " ++ int(H);
                error -> "install " ++ int(maps:get(cid, Cmd))
            end;
        activate -> "activate " ++ int(maps:get(cid, Cmd));
        drain -> "drain " ++ int(maps:get(cid, Cmd));
        release -> "release " ++ int(maps:get(cid, Cmd));
        fail -> "fail " ++ int(maps:get(cid, Cmd)) ++ " " ++ maps:get(reason, Cmd);
        recycle -> "recycle " ++ int(maps:get(cid, Cmd));
        tick -> "tick 1s";
        inject ->
            Base = "inject " ++ int(maps:get(cid, Cmd)) ++ " " ++
                   int(maps:get(payload_bytes, Cmd)) ++ "B",
            case maps:find(corrupt, Cmd) of
                {ok, Corrupt} -> Base ++ " corrupt-" ++ Corrupt;
                error -> Base
            end;
        fail_link -> "fail-link " ++ maps:get(link_id, Cmd);
        restore_link -> "restore-link " ++ maps:get(link_id, Cmd);
        revise_tariff ->
            "revise-tariff " ++ int(maps:get(tariff_id, Cmd)) ++
            " setup " ++ int(maps:get(setup, Cmd));
        pricing_vector -> "pricing-vector";
        reset -> "reset"
    end.

int(N) -> integer_to_list(N).

%%%-------------------------------------------------------------------
%%% Commands: exchange-level
%%%-------------------------------------------------------------------

do_reset(State, Cmd, Label) ->
    kill_actors(State),
    Fresh = (initial_state())#{next_tx := 1},
    finish(Fresh, maps:get(tx_id, Cmd), Label, true,
           "Exchange reset to the reference topology.").

do_create(State, Cmd, Label) ->
    TxId = maps:get(tx_id, Cmd),
    Src = maps:get(src, Cmd), Dst = maps:get(dst, Cmd),
    Bps = maps:get(bps, Cmd), Prio = maps:get(priority, Cmd),
    Qos = maps:get(qos, Cmd), TariffId = maps:get(tariff_id, Cmd),
    Nodes = scf_model:nodes(),
    KnownNodes = lists:member(Src, Nodes) andalso lists:member(Dst, Nodes),
    Valid =
        case {KnownNodes, Src =:= Dst, is_integer(Bps) andalso Bps > 0,
              is_integer(Prio) andalso Prio >= 0 andalso Prio =< 7,
              is_integer(Qos) andalso Qos >= 0 andalso Qos =< 15} of
            {false, _, _, _, _} -> {false, "Unknown endpoint."};
            {_, true, _, _, _} -> {false, "SAME_ENDPOINT"};
            {_, _, false, _, _} -> {false, "BAD_BANDWIDTH"};
            {_, _, _, false, _} -> {false, "BAD_PRIORITY"};
            {_, _, _, _, false} -> {false, "BAD_QOS"};
            _ ->
                case [T || T <- maps:get(tariffs, State),
                           maps:get(id, T) =:= TariffId] of
                    [] -> {false, "UNKNOWN_TARIFF"};
                    _ -> true
                end
        end,
    case Valid of
        {false, Detail} ->
            finish(State, TxId, Label, false, Detail);
        true ->
            Id = maps:get(next_id, State),
            {ok, Pid} = circuit_actor:start_link(
                          #{id => Id, namespace => scf_model:namespace_id()}),
            C = #{id => Id, namespace_id => scf_model:namespace_id(),
                  lifecycle => 1, state => "FREE",
                  src => Src, dst => Dst,
                  requested_bps => Bps, reserved_bps => 0,
                  priority => Prio, qos => Qos, tariff_id => TariffId,
                  tariff_lock => none, path => [], link_ids => [],
                  entries => [], install_completed => false,
                  held_reservation => false, duration_s => 0,
                  bytes_sent => 0, bytes_recv => 0,
                  packets_sent => 0, packets_recv => 0,
                  next_sequence => 1, next_event_seq => 1,
                  final_emitted => false, decision => none, pid => Pid},
            Next = put_circuit(State, C),
            Next2 = Next#{next_id := Id + 1,
                          order := maps:get(order, Next) ++ [Id]},
            Detail = lists:flatten(io_lib:format(
                       "Circuit ~B FREE. ~ts→~ts ~ts.",
                       [Id, Src, Dst, scf_model:format_bps(Bps)])),
            finish(Next2, TxId, Label, true, Detail)
    end.

do_tick(State, Cmd, Label) ->
    TxId = maps:get(tx_id, Cmd),
    NewSeconds = maps:get(seconds, State) + 1,
    Start = State#{seconds := NewSeconds},
    Outcome =
        lists:foldl(
          fun (_Id, {error, _, _} = Err) -> Err;
              (Id, {ok, Acc, Charged}) ->
                  C = maps:get(Id, maps:get(circuits, Acc)),
                  Held = maps:get(held_reservation, C),
                  Reserved = maps:get(reserved_bps, C),
                  Lock = maps:get(tariff_lock, C),
                  InHeld = lists:member(maps:get(state, C),
                                        scf_model:held_states()),
                  case Held andalso Reserved > 0 andalso InHeld andalso
                       Lock =/= none of
                      false -> {ok, Acc, Charged};
                      true ->
                          Amount = Reserved * maps:get(rate_bps, Lock),
                          case Amount > ?INT64_MAX of
                              true -> {error, Id, Acc};
                              false ->
                                  Seq = maps:get(next_event_seq, C),
                                  Event = #{circuit_id => Id,
                                            lifecycle => maps:get(lifecycle, C),
                                            seq => Seq, kind => "RESERVATION",
                                            amount => Amount,
                                            detail => lists:flatten(io_lib:format(
                                                "~B bps × ~B minor/bps/s × 1s",
                                                [Reserved, maps:get(rate_bps, Lock)])),
                                            second => NewSeconds},
                                  Acc1 = push_ledger(Acc, Event),
                                  C1 = C#{duration_s := maps:get(duration_s, C) + 1,
                                          next_event_seq := Seq + 1},
                                  {ok, put_circuit(Acc1, C1), Charged ++ [Id]}
                          end
                  end
          end, {ok, Start, []}, maps:get(order, State)),
    case Outcome of
        {error, BadId, _} ->
            finish(State, TxId, Label, false,
                   "INT64_OVERFLOW on circuit " ++ int(BadId) ++
                   ". Clock not advanced.");
        {ok, Next, []} ->
            finish(Next, TxId, Label, true,
                   "t=" ++ int(NewSeconds) ++ "s. No held reservations.");
        {ok, Next, Charged} ->
            List = string:join(["#" ++ int(I) || I <- Charged], ", "),
            finish(Next, TxId, Label, true,
                   "t=" ++ int(NewSeconds) ++ "s. Reservation posted for " ++
                   List ++ ".")
    end.

do_fail_link(State, Cmd, Label) ->
    TxId = maps:get(tx_id, Cmd),
    LinkId = maps:get(link_id, Cmd),
    Links = maps:get(links, State),
    case [L || L <- Links, maps:get(id, L) =:= LinkId] of
        [] ->
            finish(State, TxId, Label, false, "Unknown link.");
        [Link] ->
            case maps:get(down, Link) of
                true ->
                    finish(State, TxId, Label, true,
                           LinkId ++ " was already down.");
                false ->
                    Down = [case maps:get(id, L) of
                                I when I =:= LinkId -> L#{down => true};
                                _ -> L
                            end || L <- Links],
                    S1 = State#{links := Down},
                    {S2, Hit} =
                        lists:foldl(
                          fun (Id, {Acc, HitAcc}) ->
                                  C = maps:get(Id, maps:get(circuits, Acc)),
                                  OnLink = lists:member(LinkId,
                                                        maps:get(link_ids, C)),
                                  CState = maps:get(state, C),
                                  Skip = lists:member(CState, ["FREE", "RELEASED",
                                                               "FAILED", "REQUESTED"]),
                                  if not OnLink -> {Acc, HitAcc};
                                     Skip -> {Acc, HitAcc};
                                     CState =:= "ADMITTED" ->
                                         D = #{circuit_id => Id,
                                               action => "reject",
                                               path => maps:get(path, C),
                                               link_ids => maps:get(link_ids, C),
                                               reserved_bps => maps:get(requested_bps, C),
                                               tariff_id => maps:get(tariff_id, C),
                                               reason_code => "LINK_DOWN"},
                                         {put_circuit(Acc, C#{decision := D}), HitAcc};
                                     true ->
                                         {failed, _} = circuit_actor:fail(
                                                         maps:get(pid, C), link_down),
                                         {put_circuit(Acc, C#{state := "FAILED"}),
                                          HitAcc ++ [Id]}
                                  end
                          end, {S1, []}, maps:get(order, S1)),
                    Detail = case Hit of
                                 [] -> LinkId ++ " down. No installed circuit to fail.";
                                 _ ->
                                     List = string:join(["#" ++ int(I) || I <- Hit], ", "),
                                     LinkId ++ " down. Failed circuits " ++ List ++
                                     ". Bandwidth still held until release."
                             end,
                    finish(S2, TxId, Label, true, Detail)
            end
    end.

do_restore_link(State, Cmd, Label) ->
    TxId = maps:get(tx_id, Cmd),
    LinkId = maps:get(link_id, Cmd),
    Links = maps:get(links, State),
    case [L || L <- Links, maps:get(id, L) =:= LinkId] of
        [] ->
            finish(State, TxId, Label, false, "Unknown link.");
        [Link] ->
            case maps:get(down, Link) of
                false ->
                    finish(State, TxId, Label, true,
                           LinkId ++ " was already up.");
                true ->
                    Up = [case maps:get(id, L) of
                              I when I =:= LinkId -> L#{down => false};
                              _ -> L
                          end || L <- Links],
                    finish(State#{links := Up}, TxId, Label, true,
                           LinkId ++ " restored. Failed circuits are not automatically rebuilt.")
            end
    end.

do_revise_tariff(State, Cmd, Label) ->
    TxId = maps:get(tx_id, Cmd),
    TariffId = maps:get(tariff_id, Cmd),
    Setup = maps:get(setup, Cmd),
    Tariffs = maps:get(tariffs, State),
    case [T || T <- Tariffs, maps:get(id, T) =:= TariffId] of
        [] ->
            finish(State, TxId, Label, false, "UNKNOWN_TARIFF");
        [Tariff] ->
            case is_integer(Setup) andalso Setup >= 0 of
                false ->
                    finish(State, TxId, Label, false,
                           "Setup fee must be a non-negative integer minor unit.");
                true ->
                    NewVersion = maps:get(version, Tariff) + 1,
                    Next = [case maps:get(id, T) of
                                I when I =:= TariffId ->
                                    T#{version => NewVersion, setup => Setup};
                                _ -> T
                            end || T <- Tariffs],
                    Detail = lists:flatten(io_lib:format(
                               "Tariff ~B version ~B. Already-admitted circuits keep version ~B.",
                               [TariffId, NewVersion, maps:get(version, Tariff)])),
                    finish(State#{tariffs := Next}, TxId, Label, true, Detail)
            end
    end.

%%%-------------------------------------------------------------------
%%% Commands: lifecycle transitions (executed by circuit_actor)
%%%-------------------------------------------------------------------

do_transition(State, Cmd, Label) ->
    case require_circuit(State, Cmd, Label) of
        {ok, C} ->
            Type = maps:get(type, Cmd),
            case Type of
                request -> t_request(State, Cmd, Label, C);
                reject -> t_reject(State, Cmd, Label, C);
                timeout -> t_timeout(State, Cmd, Label, C);
                admit -> t_admit(State, Cmd, Label, C);
                reserve -> t_reserve(State, Cmd, Label, C);
                install -> t_install(State, Cmd, Label, C);
                activate -> t_activate(State, Cmd, Label, C);
                drain -> t_drain(State, Cmd, Label, C);
                fail -> t_fail(State, Cmd, Label, C);
                release -> t_release(State, Cmd, Label, C);
                recycle -> t_recycle(State, Cmd, Label, C);
                _ -> finish(State, maps:get(tx_id, Cmd), Label, false,
                            "Unhandled command.")
            end;
        {done, {State1, Result}} ->
            {State1, Result}
    end.

guard(State, Cmd, Label, C, Allowed) ->
    CState = maps:get(state, C),
    case lists:member(CState, Allowed) of
        true -> ok;
        false -> {illegal, illegal(State, Cmd, Label, CState)}
    end.

t_request(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["FREE"]) of
        {illegal, R} -> R;
        ok ->
            Spec = #{src => maps:get(src, C), dst => maps:get(dst, C),
                     bw => maps:get(requested_bps, C),
                     priority => maps:get(priority, C),
                     qos => maps:get(qos, C),
                     tariff_id => maps:get(tariff_id, C)},
            ok = circuit_actor:request(maps:get(pid, C), Spec),
            Next = put_circuit(State, C#{state := "REQUESTED", decision := none}),
            finish(Next, maps:get(tx_id, Cmd), Label, true,
                   "Circuit " ++ int(maps:get(id, C)) ++ " REQUESTED.")
    end.

t_reject(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["REQUESTED"]) of
        {illegal, R} -> R;
        ok ->
            {rejected, _} = circuit_actor:reject(maps:get(pid, C), operator),
            Decision = scf_model:decide(maps:get(links, State),
                                        maps:get(tariffs, State), C),
            Reason = case maps:get(reason_code, Decision) of
                         "OK" -> "OPERATOR_REJECT";
                         Other -> Other
                     end,
            D = Decision#{action => "reject", reason_code => Reason},
            Next = put_circuit(State, C#{state := "FREE", decision := D}),
            finish(Next, maps:get(tx_id, Cmd), Label, true,
                   "Circuit " ++ int(maps:get(id, C)) ++ " rejected → FREE.")
    end.

t_timeout(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["REQUESTED"]) of
        {illegal, R} -> R;
        ok ->
            timeout = circuit_actor:timeout(maps:get(pid, C)),
            Next = put_circuit(State, C#{state := "FREE", decision := none}),
            finish(Next, maps:get(tx_id, Cmd), Label, true,
                   "Circuit " ++ int(maps:get(id, C)) ++ " timeout → FREE.")
    end.

t_admit(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["REQUESTED"]) of
        {illegal, R} -> R;
        ok ->
            Decision = scf_model:decide(maps:get(links, State),
                                        maps:get(tariffs, State), C),
            case maps:get(action, Decision) of
                "admit" ->
                    ok = circuit_actor:admit(maps:get(pid, C)),
                    Tariff = hd([T || T <- maps:get(tariffs, State),
                                      maps:get(id, T) =:= maps:get(tariff_id, C)]),
                    Lock = maps:with([id, version, setup, rate_bps, rate_byte,
                                      prio_mult], Tariff),
                    Seq = maps:get(next_event_seq, C),
                    Event = #{circuit_id => maps:get(id, C),
                              lifecycle => maps:get(lifecycle, C),
                              seq => Seq, kind => "ESTABLISHMENT",
                              amount => maps:get(setup, Lock),
                              detail => lists:flatten(io_lib:format(
                                          "Setup fee. Tariff ~B version ~B locked.",
                                          [maps:get(id, Lock),
                                           maps:get(version, Lock)])),
                              second => maps:get(seconds, State)},
                    C1 = C#{state := "ADMITTED", decision := Decision,
                            path := maps:get(path, Decision),
                            link_ids := maps:get(link_ids, Decision),
                            tariff_lock := Lock, next_event_seq := Seq + 1},
                    Next = push_ledger(put_circuit(State, C1), Event),
                    Detail = lists:flatten(io_lib:format(
                                "Circuit ~B ADMITTED on ~ts. Tariff v~B locked. Setup ~B minor.",
                                [maps:get(id, C),
                                 scf_model:path_label(maps:get(path, Decision)),
                                 maps:get(version, Lock), maps:get(setup, Lock)])),
                    finish(Next, maps:get(tx_id, Cmd), Label, true, Detail);
                _ ->
                    Next = put_circuit(State, C#{decision := Decision}),
                    finish(Next, maps:get(tx_id, Cmd), Label, false,
                           "Admission refused: " ++ maps:get(reason_code, Decision) ++
                           ". State stays REQUESTED.")
            end
    end.

t_reserve(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["ADMITTED"]) of
        {illegal, R} -> R;
        ok ->
            case maps:get(link_ids, C) of
                [] ->
                    finish(State, maps:get(tx_id, Cmd), Label, false,
                           "No admitted path.");
                LinkIds ->
                    case add_reservation(maps:get(links, State), LinkIds,
                                         maps:get(requested_bps, C)) of
                        none ->
                            PathText = scf_model:path_label(maps:get(path, C)),
                            case scf_model:find_path(maps:get(links, State),
                                                     maps:get(src, C),
                                                     maps:get(dst, C),
                                                     maps:get(requested_bps, C)) of
                                {ok, AltPath, AltLinks} ->
                                    D = #{circuit_id => maps:get(id, C),
                                          action => "reroute", path => AltPath,
                                          link_ids => AltLinks,
                                          reserved_bps => maps:get(requested_bps, C),
                                          tariff_id => maps:get(tariff_id, C),
                                          reason_code => "ALT_PATH"},
                                    Next = put_circuit(State, C#{decision := D}),
                                    finish(Next, maps:get(tx_id, Cmd), Label, false,
                                           "NO_CAPACITY on " ++ PathText ++
                                           ". Alternative " ++
                                           scf_model:path_label(AltPath) ++
                                           " is feasible but there is no reroute transition. State stays ADMITTED.");
                                none ->
                                    finish(State, maps:get(tx_id, Cmd), Label, false,
                                           "NO_CAPACITY on " ++ PathText ++
                                           ". State stays ADMITTED.")
                            end;
                        {ok, NewLinks} ->
                            ok = circuit_actor:reserve(maps:get(pid, C)),
                            C1 = C#{state := "RESERVED",
                                    reserved_bps := maps:get(requested_bps, C),
                                    held_reservation := true},
                            Next = put_circuit(State#{links := NewLinks}, C1),
                            Detail = lists:flatten(io_lib:format(
                                        "Circuit ~B RESERVED ~ts on ~ts.",
                                        [maps:get(id, C),
                                         scf_model:format_bps(maps:get(requested_bps, C)),
                                         string:join(LinkIds, ", ")])),
                            finish(Next, maps:get(tx_id, Cmd), Label, true, Detail)
                    end
            end
    end.

add_reservation(Links, LinkIds, Bps) ->
    Feasible = lists:all(
                 fun (Id) ->
                         case [L || L <- Links, maps:get(id, L) =:= Id] of
                             [L] ->
                                 (not maps:get(down, L)) andalso
                                 maps:get(reserved_bps, L) + Bps =<
                                     maps:get(capacity_bps, L);
                             [] -> false
                         end
                 end, LinkIds),
    case Feasible of
        false -> none;
        true ->
            {ok, [case lists:member(maps:get(id, L), LinkIds) of
                      true -> L#{reserved_bps := maps:get(reserved_bps, L) + Bps};
                      false -> L
                  end || L <- Links]}
    end.

sub_reservation(Links, LinkIds, Bps) ->
    [case lists:member(maps:get(id, L), LinkIds) of
         true -> L#{reserved_bps := max(0, maps:get(reserved_bps, L) - Bps)};
         false -> L
     end || L <- Links].

t_install(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["RESERVED"]) of
        {illegal, R} -> R;
        ok ->
            Planned = scf_model:entries_for(maps:get(path, C)),
            case maps:find(fault_hop, Cmd) of
                {ok, Hop} when Hop < 0 orelse Hop >= length(Planned) ->
                    finish(State, maps:get(tx_id, Cmd), Label, false,
                           "Fault hop is outside the path.");
                {ok, Hop} ->
                    {failed, _} = circuit_actor:fail(maps:get(pid, C),
                                                     partial_install),
                    Node = maps:get(node, lists:nth(Hop + 1, Planned)),
                    C1 = C#{state := "FAILED", entries := [],
                            install_completed := false},
                    Next = put_circuit(State, C1),
                    Detail = lists:flatten(io_lib:format(
                                "PARTIAL_INSTALL at hop ~B (~ts). Written entries rolled back. Circuit ~B FAILED. Bandwidth still held.",
                                [Hop, Node, maps:get(id, C)])),
                    finish(Next, maps:get(tx_id, Cmd), Label, true, Detail);
                error ->
                    ok = circuit_actor:install(maps:get(pid, C),
                                               #{labels => Planned}),
                    C1 = C#{state := "INSTALLED", entries := Planned,
                            install_completed := true},
                    Next = put_circuit(State, C1),
                    EntriesText = string:join(
                        [maps:get(node, E) ++ ":" ++ maps:get(ingress, E) ++
                         "→" ++ maps:get(egress, E) || E <- Planned], " · "),
                    Detail = "Circuit " ++ int(maps:get(id, C)) ++
                             " INSTALLED. " ++ EntriesText,
                    finish(Next, maps:get(tx_id, Cmd), Label, true, Detail)
            end
    end.

t_activate(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["INSTALLED"]) of
        {illegal, R} -> R;
        ok ->
            ok = circuit_actor:activate(maps:get(pid, C)),
            Next = put_circuit(State, C#{state := "ACTIVE"}),
            finish(Next, maps:get(tx_id, Cmd), Label, true,
                   "Circuit " ++ int(maps:get(id, C)) ++
                   " ACTIVE. Accounting usage may begin.")
    end.

t_drain(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["ACTIVE"]) of
        {illegal, R} -> R;
        ok ->
            ok = circuit_actor:drain(maps:get(pid, C)),
            Next = put_circuit(State, C#{state := "DRAINING"}),
            finish(Next, maps:get(tx_id, Cmd), Label, true,
                   "Circuit " ++ int(maps:get(id, C)) ++
                   " DRAINING. New data frames will be dropped.")
    end.

t_fail(State, Cmd, Label, C) ->
    CState = maps:get(state, C),
    case lists:member(CState, ["FREE", "RELEASED", "FAILED", "REQUESTED"]) of
        true -> illegal(State, Cmd, Label, CState);
        false ->
            Reason = maps:get(reason, Cmd),
            {failed, _} = circuit_actor:fail(maps:get(pid, C), operator),
            Next = put_circuit(State, C#{state := "FAILED"}),
            HeldText = case maps:get(held_reservation, C) of
                           true -> "Bandwidth still held.";
                           false -> "No bandwidth was held."
                       end,
            Detail = lists:flatten(io_lib:format(
                        "Circuit ~B FAILED (~ts). ~ts",
                        [maps:get(id, C), Reason, HeldText])),
            finish(Next, maps:get(tx_id, Cmd), Label, true, Detail)
    end.

t_release(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["DRAINING", "FAILED"]) of
        {illegal, R} -> R;
        ok ->
            case maps:get(final_emitted, C) of
                true ->
                    finish(State, maps:get(tx_id, Cmd), Label, false,
                           "Final accounting event already exists.");
                false ->
                    release_settle(State, Cmd, Label, C)
            end
    end.

release_settle(State, Cmd, Label, C) ->
    Lock = maps:get(tariff_lock, C),
    Settlement =
        case Lock of
            none -> {ok, 0, "No tariff lock; final amount 0."};
            _ ->
                Bytes = maps:get(bytes_sent, C) + maps:get(bytes_recv, C),
                case scf_model:charge(Lock, maps:get(reserved_bps, C),
                                      maps:get(duration_s, C), Bytes,
                                      maps:get(priority, C)) of
                    {error, ChargeReason} -> {error, ChargeReason};
                    {ok, B} ->
                        Amount = maps:get(usage, B) + maps:get(priority, B),
                        SettleText = lists:flatten(io_lib:format(
                                    "Usage ~B + priority ~B minor. Setup and reservation were already posted.",
                                    [maps:get(usage, B), maps:get(priority, B)])),
                        {ok, Amount, SettleText}
                end
        end,
    case Settlement of
        {error, SettleReason} ->
            finish(State, maps:get(tx_id, Cmd), Label, false,
                   "Settlement rejected: " ++ SettleReason ++ ". State unchanged.");
        {ok, FinalAmount, FinalDetail} ->
            ok = circuit_actor:release(maps:get(pid, C)),
            S1 = case maps:get(reserved_bps, C) > 0 of
                     true ->
                         State#{links := sub_reservation(
                                            maps:get(links, State),
                                            maps:get(link_ids, C),
                                            maps:get(reserved_bps, C))};
                     false -> State
                 end,
            Seq = maps:get(next_event_seq, C),
            Event = #{circuit_id => maps:get(id, C),
                      lifecycle => maps:get(lifecycle, C),
                      seq => Seq, kind => "FINAL", amount => FinalAmount,
                      detail => FinalDetail,
                      second => maps:get(seconds, S1)},
            C1 = C#{state := "RELEASED", reserved_bps := 0, entries := [],
                    final_emitted := true, next_event_seq := Seq + 1},
            Next = push_ledger(put_circuit(S1, C1), Event),
            ReleaseText = lists:flatten(io_lib:format(
                        "Circuit ~B RELEASED. Final ~B minor. Resources returned once.",
                        [maps:get(id, C), FinalAmount])),
            finish(Next, maps:get(tx_id, Cmd), Label, true, ReleaseText)
    end.

t_recycle(State, Cmd, Label, C) ->
    case guard(State, Cmd, Label, C, ["RELEASED"]) of
        {illegal, R} -> R;
        ok ->
            ok = circuit_actor:recycle(maps:get(pid, C)),
            NewLifecycle = maps:get(lifecycle, C) + 1,
            C1 = C#{state := "FREE", lifecycle := NewLifecycle,
                    reserved_bps := 0, path := [], link_ids := [],
                    entries := [], install_completed := false,
                    held_reservation := false, duration_s := 0,
                    bytes_sent := 0, bytes_recv := 0,
                    packets_sent := 0, packets_recv := 0,
                    next_sequence := 1, next_event_seq := 1,
                    final_emitted := false, tariff_lock := none,
                    decision := none},
            Next = put_circuit(State, C1),
            Detail = lists:flatten(io_lib:format(
                        "Circuit ~B recycled → FREE. Lifecycle ~B.",
                        [maps:get(id, C), NewLifecycle])),
            finish(Next, maps:get(tx_id, Cmd), Label, true, Detail)
    end.

%%%-------------------------------------------------------------------
%%% Commands: frame injection (console-side; packet path stays
%%% outside the actor runtime)
%%%-------------------------------------------------------------------

do_inject(State, Cmd, Label) ->
    TxId = maps:get(tx_id, Cmd),
    case require_circuit(State, Cmd, Label) of
        {done, {State1, Result}} -> {State1, Result};
        {ok, C} ->
            N = maps:get(payload_bytes, Cmd),
            case is_integer(N) andalso N >= 0 andalso N =< 2048 of
                false ->
                    finish(State, TxId, Label, false,
                           "Payload must be 0..2048 bytes.");
                true ->
                    inject_frame(State, Cmd, Label, C, N)
            end
    end.

inject_frame(State, Cmd, Label, C, N) ->
    TxId = maps:get(tx_id, Cmd),
    Cid = maps:get(id, C),
    Payload = << <<((I * 17 + Cid) band 16#FF)>> || I <- lists:seq(0, N - 1) >>,
    Corrupt = case maps:find(corrupt, Cmd) of
                  {ok, V} -> V;
                  error -> none
              end,
    Fields0 = #{circuit_id => Cid, priority => maps:get(priority, C),
                qos => maps:get(qos, C),
                sequence => maps:get(next_sequence, C)},
    Fields = case Corrupt of
                 "magic" -> Fields0#{magic => 0};
                 "version" -> Fields0#{version => 2};
                 "length" -> Fields0#{payload_length => N + 1};
                 _ -> Fields0
             end,
    Frame0 = scf_model:encode_frame(Fields, Payload),
    Frame = case Corrupt of
                "checksum" ->
                    <<Head:18/binary, B, Rest/binary>> = Frame0,
                    <<Head/binary, (B bxor 16#FF), Rest/binary>>;
                _ -> Frame0
            end,
    Parsed = scf_model:parse_frame(Frame),
    Drop = classify_drop(State, C, Frame, Parsed),
    LastFrame = #{hex => scf_model:to_hex(Frame),
                  accepted => Drop =:= none,
                  reason => case Drop of none -> "ACCEPTED"; _ -> Drop end,
                  circuit_id => Cid, parsed => Parsed},
    Sender = C#{next_sequence := maps:get(next_sequence, C) + 1},
    S1 = State#{last_frame := LastFrame},
    case Drop of
        none ->
            C1 = Sender#{bytes_sent := maps:get(bytes_sent, C) + N,
                         packets_sent := maps:get(packets_sent, C) + 1},
            Next = put_circuit(S1, C1),
            Detail = lists:flatten(io_lib:format(
                        "Accepted ~B B on circuit ~B. seq ~B.",
                        [N, Cid, maps:get(next_sequence, C)])),
            finish(Next, TxId, Label, true, Detail);
        _ ->
            Next = put_circuit(S1, Sender),
            finish(Next, TxId, Label, false, "Dropped: " ++ Drop ++ ".")
    end.

classify_drop(_State, _C, Frame, none) when byte_size(Frame) < 20 ->
    "TRUNCATED";
classify_drop(State, C, Frame, Parsed) ->
    Checks =
        [fun () -> byte_size(Frame) < 20 end,
         fun () -> maps:get(magic, Parsed) =/= scf_model:magic() end,
         fun () -> maps:get(version, Parsed) =/= scf_model:frame_version() end,
         fun () -> maps:get(circuit_id, Parsed) =:= 0 end,
         fun () -> maps:get(payload_length, Parsed) =/= byte_size(Frame) - 20 end,
         fun () -> not scf_model:checksum_valid(Frame) end,
         fun () -> (maps:get(flags, Parsed) band 16#02) =:= 0 end],
    Reasons = ["TRUNCATED", "MAGIC", "VERSION", "CIRCUIT_ID", "LENGTH",
               "CHECKSUM", "NOT_DATA"],
    case first_hit(Checks, Reasons) of
        {ok, Reason} -> Reason;
        none ->
            CState = maps:get(state, C),
            if CState =/= "ACTIVE" ->
                   "ADMISSION_" ++ CState;
               true ->
                   Installed = maps:get(entries, C) =/= [] andalso
                               maps:get(install_completed, C),
                   case Installed of
                       false -> "NO_TABLE";
                       true ->
                           Target = [X || X <- [maps:get(I, maps:get(circuits, State))
                                                || I <- maps:get(order, State)],
                                          maps:get(id, X) =:= maps:get(circuit_id, Parsed),
                                          maps:get(namespace_id, X) =:= maps:get(namespace_id, Parsed)],
                           case Target of
                               [T] ->
                                   case maps:get(state, T) of
                                       "ACTIVE" -> none;
                                       _ -> "NO_TABLE"
                                   end;
                               _ -> "NO_TABLE"
                           end
                   end
            end
    end.

first_hit([], []) -> none;
first_hit([Check | Checks], [Reason | Reasons]) ->
    case Check() of
        true -> {ok, Reason};
        false -> first_hit(Checks, Reasons)
    end.

%%%-------------------------------------------------------------------
%%% Command: pricing vector — replays the documented lifecycle for
%%% the pricing.erl basic_charge_test inputs and settles it. Atomic:
%%% a failed step discards every step's effects.
%%%-------------------------------------------------------------------

do_pricing_vector(State, Cmd, Label) ->
    TxId = maps:get(tx_id, Cmd),
    Cid = maps:get(next_id, State),
    StepTypes = [create, request, admit, reserve, install, activate, inject]
                ++ lists:duplicate(10, tick) ++ [drain, release],
    Steps = [step_cmd(T, TxId, I, Cid)
             || {T, I} <- lists:zip(StepTypes, lists:seq(0, length(StepTypes) - 1))],
    Outcome = lists:foldl(
                fun (_Step, {error, _, _} = Err) -> Err;
                    (Step, {ok, Cursor}) ->
                        case apply_cmd(Cursor, Step) of
                            {Next, {true, _, _}} -> {ok, Next};
                            {_Next, {false, _, Detail}} ->
                                {error, cmd_label(Step), Detail}
                        end
                end, {ok, State}, Steps),
    case Outcome of
        {error, StepLabel, StepDetail} ->
            finish(State, TxId, Label, false,
                   "Stopped at " ++ StepLabel ++ ": " ++ StepDetail);
        {ok, Cursor} ->
            Events = [E || E <- maps:get(ledger, Cursor),
                           maps:get(circuit_id, E) =:= Cid],
            Total = lists:sum([maps:get(amount, E) || E <- Events]),
            Ok = Total =:= 2500,
            Detail = case Ok of
                         true ->
                             lists:flatten(io_lib:format(
                                 "pricing.erl basic_charge_test reproduced. Circuit ~B settled 2500 minor (0.2500).",
                                 [Cid]));
                         false ->
                             lists:flatten(io_lib:format(
                                 "Vector finished but total is ~B minor, not 2500. This is a console defect if tariffs were unchanged.",
                                 [Total]))
                     end,
            Merged = Cursor#{next_tx := max(maps:get(next_tx, Cursor),
                                            maps:get(next_tx, State) +
                                            length(Steps))},
            finish(Merged, TxId, Label, Ok, Detail)
    end.

step_cmd(create, TxId, I, Cid) ->
    #{type => create, tx_id => step_tx(TxId, I), src => "N", dst => "S",
      bps => 100, priority => 2, qos => 1, tariff_id => 1, cid => Cid};
step_cmd(inject, TxId, I, Cid) ->
    #{type => inject, tx_id => step_tx(TxId, I), cid => Cid,
      payload_bytes => 50};
step_cmd(tick, TxId, I, _Cid) ->
    #{type => tick, tx_id => step_tx(TxId, I)};
step_cmd(Type, TxId, I, Cid) ->
    #{type => Type, tx_id => step_tx(TxId, I), cid => Cid}.

step_tx(TxId, I) -> TxId ++ "-step-" ++ integer_to_list(I).
