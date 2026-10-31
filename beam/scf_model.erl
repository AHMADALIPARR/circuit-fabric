%%%-------------------------------------------------------------------
%%% @doc Sovereign Circuit Fabric — console model (pure functions).
%%%
%%% Port of the Phase I reference model: fabric topology, admission
%%% decisions, deterministic pathfinding, the 20-byte circuit frame
%%% codec, tariff arithmetic, and the invariant checks.
%%%
%%% Tariff arithmetic is not transcribed here. It calls the exported
%%% components of accounting/pricing.erl (setup_fee/1,
%%% reserved_charge/3, usage_charge/2, priority_charge/3), the same
%%% module the pricing vector reproduces.
%%%
%%% Frame magic is 0x5343, the 16-bit ASCII encoding of "SC", per the
%%% baseline decision recorded in the sovereign-circuit-fabric
%%% repository (spec/circuit_frame.md). All multi-byte frame fields
%%% are network byte order.
%%%-------------------------------------------------------------------
-module(scf_model).

-export([magic/0, frame_version/0, namespace_id/0, minor_scale/0,
         nodes/0, node_name/1,
         initial_links/0, initial_tariffs/0,
         format_minor/1, format_bps/1,
         charge/5,
         internet_checksum/1, checksum_valid/1,
         encode_frame/2, parse_frame/1, to_hex/1, hex_groups/1,
         neighbors/3, find_path/4, decide/3, entries_for/1,
         check_invariants/1, actions_for/2,
         path_label/1, link_endpoints/1, held_states/0]).

-define(INT64_MAX, 9223372036854775807).

magic() -> 16#5343.
frame_version() -> 1.
namespace_id() -> 0.
minor_scale() -> 10000.

nodes() -> ["N", "E", "S", "W"].

node_name("N") -> "North";
node_name("E") -> "East";
node_name("S") -> "South";
node_name("W") -> "West".

held_states() -> ["RESERVED", "INSTALLED", "ACTIVE", "DRAINING", "FAILED"].

forwarding_states() -> ["INSTALLED", "ACTIVE", "DRAINING"].

%%%-------------------------------------------------------------------
%%% Reference topology and tariffs
%%%-------------------------------------------------------------------

initial_tariffs() ->
    [#{id => 1, version => 1, name => "T1 reference",
       setup => 1000, rate_bps => 1, rate_byte => 2, prio_mult => 10,
       origin => "accounting/pricing.erl basic_charge_test"},
     #{id => 2, version => 1, name => "T2 bulk",
       setup => 2500, rate_bps => 2, rate_byte => 1, prio_mult => 5,
       origin => "Console tariff. Not defined in pricing.erl."}].

initial_links() ->
    [#{id => "N-E", a => "N", b => "E", capacity_bps => 10000000,
       reserved_bps => 0, down => false},
     #{id => "N-W", a => "N", b => "W", capacity_bps => 10000000,
       reserved_bps => 0, down => false},
     #{id => "S-E", a => "S", b => "E", capacity_bps => 10000000,
       reserved_bps => 0, down => false},
     #{id => "S-W", a => "S", b => "W", capacity_bps => 10000000,
       reserved_bps => 0, down => false},
     #{id => "W-E", a => "W", b => "E", capacity_bps => 20000000,
       reserved_bps => 0, down => false}].

%%%-------------------------------------------------------------------
%%% Formatting
%%%-------------------------------------------------------------------

%% Minor units render at 1/10000 scale: 2500 -> "0.2500".
%% Negatives carry U+2212, matching the reference console.
format_minor(Amount) when is_integer(Amount) ->
    Neg = Amount < 0,
    Digits = integer_to_list(abs(Amount)),
    Padded = lists:flatten(io_lib:format("~5..0s", [Digits])),
    Whole = case length(Padded) - 4 of
                N when N > 0 -> lists:sublist(Padded, N);
                _ -> "0"
            end,
    Frac = lists:nthtail(length(Padded) - 4, Padded),
    case Neg of
        true -> unicode:characters_to_list("−") ++ Whole ++ "." ++ Frac;
        false -> Whole ++ "." ++ Frac
    end.

format_bps(Bps) when is_integer(Bps) ->
    Abs = abs(Bps),
    if Abs >= 1000000 ->
           case Bps rem 1000000 of
               0 -> integer_to_list(Bps div 1000000) ++ " Mb/s";
               _ ->
                   Text = trim_num(io_lib:format("~.2f", [Bps / 1000000])),
                   lists:flatten(Text) ++ " Mb/s"
           end;
       Abs >= 1000 ->
           case Bps rem 1000 of
               0 -> trim_num(io_lib:format("~.1f", [Bps / 1000])) ++ " kb/s";
               _ -> trim_num(io_lib:format("~.1f", [Bps / 1000])) ++ " kb/s"
           end;
       true ->
           integer_to_list(Bps) ++ " b/s"
    end.

%% Trim trailing zeros (and a bare decimal point) from a formatted float.
trim_num(IoData) ->
    S = lists:flatten(IoData),
    case string:find(S, ".") of
        nomatch -> S;
        _ ->
            T = string:trim(S, trailing, "0"),
            case T =/= "" andalso lists:last(T) =:= $. of
                true -> lists:droplast(T);
                false -> T
            end
    end.

%%%-------------------------------------------------------------------
%%% Tariff arithmetic — delegated to pricing.erl components.
%%% Returns the full breakdown; rejects above int64 as model policy.
%%%-------------------------------------------------------------------

charge(Tariff, ReservedBps, DurationS, Bytes, Priority) ->
    if ReservedBps < 0; DurationS < 0; Bytes < 0 ->
           {error, "NEGATIVE_INPUT"};
       Priority < 0; Priority > 7 ->
           {error, "BAD_PRIORITY"};
       true ->
           Setup = pricing:setup_fee(Tariff),
           Reserved = pricing:reserved_charge(Tariff, ReservedBps, DurationS),
           Usage = pricing:usage_charge(Tariff, Bytes),
           Prio = pricing:priority_charge(Tariff, Setup + Reserved, Priority),
           Total = Setup + Reserved + Usage + Prio,
           if Total > ?INT64_MAX; Reserved > ?INT64_MAX; Usage > ?INT64_MAX ->
                  {error, "INT64_OVERFLOW"};
              true ->
                  {ok, #{setup => Setup, reserved => Reserved,
                         usage => Usage, priority => Prio, total => Total}}
           end
    end.

%%%-------------------------------------------------------------------
%%% 20-byte circuit frame codec (spec/circuit_frame.md layout)
%%%-------------------------------------------------------------------

internet_checksum(Bin) when is_binary(Bin) ->
    Sum = checksum_sum(Bin, 0),
    Folded = fold_sum(Sum),
    bnot Folded band 16#FFFF.

checksum_valid(Bin) when is_binary(Bin) ->
    fold_sum(checksum_sum(Bin, 0)) =:= 16#FFFF.

checksum_sum(<<A, B, Rest/binary>>, Acc) ->
    checksum_sum(Rest, Acc + ((A bsl 8) bor B));
checksum_sum(<<A>>, Acc) ->
    Acc + (A bsl 8);
checksum_sum(<<>>, Acc) ->
    Acc.

fold_sum(Sum) when Sum > 16#FFFF ->
    fold_sum((Sum band 16#FFFF) + (Sum bsr 16));
fold_sum(Sum) ->
    Sum.

%% Fields: circuit_id, priority, qos, sequence are required; magic,
%% version, flags, namespace_id, payload_length default.
encode_frame(Fields, Payload) when is_binary(Payload) ->
    Magic = maps:get(magic, Fields, magic()),
    Version = maps:get(version, Fields, frame_version()),
    Flags = maps:get(flags, Fields, 16#02),
    CircuitId = maps:get(circuit_id, Fields),
    Ns = maps:get(namespace_id, Fields, namespace_id()),
    Priority = maps:get(priority, Fields),
    Qos = maps:get(qos, Fields),
    Sequence = maps:get(sequence, Fields),
    PayLen = maps:get(payload_length, Fields, byte_size(Payload)),
    Header0 = <<Magic:16, Version:8, Flags:8, CircuitId:32, Ns:16,
                Priority:8, Qos:8, Sequence:32, PayLen:16, 0:16>>,
    Frame0 = <<Header0/binary, Payload/binary>>,
    Checksum = internet_checksum(Frame0),
    <<Head:18/binary, _Zero:16, Rest/binary>> = Frame0,
    <<Head/binary, Checksum:16, Rest/binary>>.

parse_frame(Bin) when is_binary(Bin), byte_size(Bin) >= 20 ->
    <<Magic:16, Version:8, Flags:8, CircuitId:32, Ns:16, Priority:8,
      Qos:8, Sequence:32, PayLen:16, Checksum:16, Payload/binary>> = Bin,
    #{magic => Magic, version => Version, flags => Flags,
      circuit_id => CircuitId, namespace_id => Ns, priority => Priority,
      qos => Qos, sequence => Sequence, payload_length => PayLen,
      checksum => Checksum, payload_bytes => byte_size(Payload)};
parse_frame(_) ->
    none.

to_hex(Bin) when is_binary(Bin) ->
    lists:flatten([io_lib:format("~2.16.0b", [B]) || <<B>> <= Bin]).

hex_groups(Hex) ->
    string:trim(group_pairs(Hex)).

group_pairs([]) -> [];
group_pairs([A, B | Rest]) -> [A, B, $\s | group_pairs(Rest)];
group_pairs([A]) -> [A].

%%%-------------------------------------------------------------------
%%% Topology: neighbors, pathfinding, admission decision
%%%-------------------------------------------------------------------

link_between(Links, A, B) ->
    case [L || L <- Links,
               (maps:get(a, L) =:= A andalso maps:get(b, L) =:= B) orelse
               (maps:get(a, L) =:= B andalso maps:get(b, L) =:= A)] of
        [L] -> L;
        [] -> none
    end.

neighbors(Links, Node, IgnoreDown) ->
    Out = lists:foldl(
            fun (L, Acc) ->
                    case IgnoreDown andalso maps:get(down, L) of
                        true -> Acc;
                        false ->
                            cond_push(maps:get(a, L) =:= Node, maps:get(b, L),
                                      cond_push(maps:get(b, L) =:= Node,
                                                maps:get(a, L), Acc))
                    end
            end, [], Links),
    lists:sort(Out).

cond_push(true, V, Acc) -> [V | Acc];
cond_push(false, _V, Acc) -> Acc.

%% Shortest feasible path. Neighbor order is alphabetical, so the
%% choice is deterministic. A link is feasible when the reservation
%% fits its remaining capacity; down links are skipped.
find_path(_Links, Src, Src, _Bps) ->
    none;
find_path(Links, Src, Dst, Bps) ->
    Prev = bfs(Links, [Src], #{Src => none}, Dst, Bps),
    case maps:is_key(Dst, Prev) of
        false -> none;
        true ->
            Path = build_path(Prev, Dst, []),
            LinkIds = [maps:get(id, link_between(Links, A, B))
                       || {A, B} <- pairs(Path)],
            {ok, Path, LinkIds}
    end.

bfs(_Links, [], Prev, _Dst, _Bps) ->
    Prev;
bfs(Links, [Node | Queue], Prev, Dst, Bps) ->
    case Node =:= Dst of
        true -> Prev;
        false ->
            {Queue1, Prev1} =
                lists:foldl(
                  fun (Next, {Q, P}) ->
                          case maps:is_key(Next, P) of
                              true -> {Q, P};
                              false ->
                                  Link = link_between(Links, Node, Next),
                                  case Link =/= none andalso
                                       maps:get(reserved_bps, Link) + Bps =<
                                           maps:get(capacity_bps, Link) of
                                      true -> {Q ++ [Next], P#{Next => Node}};
                                      false -> {Q, P}
                                  end
                          end
                  end, {Queue, Prev}, neighbors(Links, Node, true)),
            bfs(Links, Queue1, Prev1, Dst, Bps)
    end.

build_path(Prev, Node, Acc) ->
    case maps:get(Node, Prev) of
        none -> [Node | Acc];
        Parent -> build_path(Prev, Parent, [Node | Acc])
    end.

pairs([_]) -> [];
pairs([A, B | Rest]) -> [{A, B} | pairs([B | Rest])].

%% Admission decision, transcribed from the reference model: field
%% validation first, then feasible-path search, distinguishing
%% NO_CAPACITY (a structural path exists) from NO_ROUTE.
decide(Links, Tariffs, C) ->
    Base = #{circuit_id => maps:get(id, C), path => [], link_ids => [],
             reserved_bps => maps:get(requested_bps, C),
             tariff_id => maps:get(tariff_id, C)},
    Src = maps:get(src, C), Dst = maps:get(dst, C),
    Bps = maps:get(requested_bps, C),
    Prio = maps:get(priority, C), Qos = maps:get(qos, C),
    if Src =:= Dst ->
           Base#{action => "reject", reason_code => "SAME_ENDPOINT"};
       not is_integer(Bps) orelse Bps =< 0 ->
           Base#{action => "reject", reason_code => "BAD_BANDWIDTH"};
       Prio < 0 orelse Prio > 7 ->
           Base#{action => "reject", reason_code => "BAD_PRIORITY"};
       Qos < 0 orelse Qos > 15 ->
           Base#{action => "reject", reason_code => "BAD_QOS"};
       true ->
           case [T || T <- Tariffs, maps:get(id, T) =:= maps:get(tariff_id, C)] of
               [] -> Base#{action => "reject", reason_code => "UNKNOWN_TARIFF"};
               _ ->
                   case find_path(Links, Src, Dst, Bps) of
                       {ok, Path, LinkIds} ->
                           Base#{action => "admit", path => Path,
                                 link_ids => LinkIds, reason_code => "OK"};
                       none ->
                           Zeroed = [L#{reserved_bps => 0} || L <- Links],
                           Reason = case find_path(Zeroed, Src, Dst, 1) of
                                        {ok, _, _} -> "NO_CAPACITY";
                                        none -> "NO_ROUTE"
                                    end,
                           Base#{action => "reject", reason_code => Reason}
                   end
           end
    end.

entries_for(Path) ->
    Indexed = lists:zip(lists:seq(0, length(Path) - 1), Path),
    [#{node => Node,
       ingress => case I of 0 -> "edge"; _ -> lists:nth(I, Path) end,
       egress => case I =:= length(Path) - 1 of
                     true -> "edge";
                     false -> lists:nth(I + 2, Path)
                 end}
     || {I, Node} <- Indexed].

path_label([]) -> "—";
path_label(Path) -> string:join(Path, "–").

link_endpoints(Link) ->
    maps:get(a, Link) ++ "–" ++ maps:get(b, Link).

%%%-------------------------------------------------------------------
%%% Invariants of the running model (Evidence tab)
%%%-------------------------------------------------------------------

check_invariants(#{links := Links, circuits := Circuits, ledger := Ledger}) ->
    [identity_check(Circuits),
     free_zero_check(Circuits),
     reservation_held_check(Circuits),
     tables_check(Circuits),
     final_once_check(Circuits),
     conservation_check(Links, Circuits),
     no_overcommit_check(Links),
     ledger_idempotent_check(Ledger),
     tariff_lock_check(Circuits)].

inv(Id, Ok, Detail) -> #{id => Id, ok => Ok, detail => Detail}.

identity_check(Circuits) ->
    {_, Dup} = lists:foldl(
                 fun (C, {Seen, DupAcc}) ->
                         case maps:get(state, C) of
                             "FREE" -> {Seen, DupAcc};
                             _ ->
                                 Key = {maps:get(namespace_id, C), maps:get(id, C)},
                                 case lists:member(Key, Seen) of
                                     true -> {Seen, true};
                                     false -> {[Key | Seen], DupAcc}
                                 end
                         end
                 end, {[], false}, Circuits),
    NoZero = lists:all(fun (C) -> maps:get(id, C) =/= 0 end, Circuits),
    inv("identity", (not Dup) andalso NoZero,
        "No circuit id 0. Non-FREE identities unique.").

free_zero_check(Circuits) ->
    Ok = lists:all(
           fun (C) ->
                   maps:get(state, C) =/= "FREE" orelse
                   (maps:get(reserved_bps, C) =:= 0 andalso
                    maps:get(entries, C) =:= [])
           end, Circuits),
    inv("free-zero", Ok,
        "FREE circuits hold no bandwidth and no table entries.").

reservation_held_check(Circuits) ->
    Ok = lists:all(
           fun (C) ->
                   State = maps:get(state, C),
                   Held = lists:member(State, ["RESERVED", "INSTALLED",
                                               "ACTIVE", "DRAINING"]),
                   FailedHeld = State =:= "FAILED" andalso
                                maps:get(held_reservation, C),
                   (not Held andalso not FailedHeld) orelse
                   maps:get(reserved_bps, C) > 0
           end, Circuits),
    inv("reservation-held", Ok,
        "From RESERVED until release, bandwidth stays positive. Includes FAILED after a successful reserve.").

tables_check(Circuits) ->
    Ok = lists:all(
           fun (C) ->
                   State = maps:get(state, C),
                   Should = lists:member(State, forwarding_states()) orelse
                            (State =:= "FAILED" andalso
                             maps:get(install_completed, C)),
                   Has = maps:get(entries, C) =/= [],
                   Guard = State =:= "FAILED" andalso
                           not maps:get(install_completed, C),
                   (Should =:= Has) orelse Guard
           end, Circuits),
    inv("tables", Ok,
        "Forwarding entries exist only after a completed install, and are cleared on release or rolled-back install.").

final_once_check(Circuits) ->
    Ok = lists:all(
           fun (C) ->
                   Released = maps:get(state, C) =:= "RELEASED",
                   Final = maps:get(final_emitted, C),
                   Released =:= Final
           end, Circuits),
    inv("final-once", Ok,
        "RELEASED iff exactly one final accounting event for this lifecycle.").

conservation_check(Links, Circuits) ->
    Ok = lists:all(
           fun (L) ->
                   Sum = lists:sum(
                           [maps:get(reserved_bps, C) || C <- Circuits,
                            maps:get(reserved_bps, C) > 0,
                            lists:member(maps:get(id, L), maps:get(link_ids, C)),
                            maps:get(state, C) =/= "RELEASED",
                            maps:get(state, C) =/= "FREE"]),
                   Sum =:= maps:get(reserved_bps, L)
           end, Links),
    inv("conservation", Ok,
        "Each link's reserved_bps equals the sum of circuits still holding that link.").

no_overcommit_check(Links) ->
    Ok = lists:all(
           fun (L) ->
                   R = maps:get(reserved_bps, L),
                   R >= 0 andalso R =< maps:get(capacity_bps, L)
           end, Links),
    inv("no-overcommit", Ok,
        "reserved_bps ≤ capacity_bps on every link.").

ledger_idempotent_check(Ledger) ->
    Keys = [{maps:get(circuit_id, E), maps:get(lifecycle, E), maps:get(seq, E)}
            || E <- Ledger],
    Unique = length(Keys) =:= length(lists:usort(Keys)),
    Integers = lists:all(fun (E) -> is_integer(maps:get(amount, E)) end, Ledger),
    inv("ledger-idempotent", Unique andalso Integers,
        "Accounting events unique by (circuit, lifecycle, seq). Amounts are integers.").

tariff_lock_check(Circuits) ->
    Ok = lists:all(
           fun (C) ->
                   State = maps:get(state, C),
                   Needs = State =/= "FREE" andalso State =/= "REQUESTED",
                   Has = maps:get(tariff_lock, C) =/= none,
                   Needs =:= Has
           end, Circuits),
    inv("tariff-lock", Ok,
        "Tariff version locks at ADMITTED and clears on recycle.").

%%%-------------------------------------------------------------------
%%% Per-circuit action availability (Circuits tab buttons)
%%%-------------------------------------------------------------------

actions_for(#{links := Links, tariffs := Tariffs}, C) ->
    State = maps:get(state, C),
    Decision = case State of
                   "REQUESTED" -> decide(Links, Tariffs, C);
                   _ -> maps:get(decision, C)
               end,
    DecisionAction = case Decision of
                         none -> none;
                         _ -> maps:get(action, Decision)
                     end,
    AdmitReason =
        if State =/= "REQUESTED" ->
               "Illegal from " ++ State ++ ".";
           DecisionAction =:= "admit" ->
               "Path " ++ path_label(maps:get(path, Decision)) ++ ".";
           true ->
               Reason = case Decision of
                            none -> "NO_DECISION";
                            _ -> maps:get(reason_code, Decision)
                        end,
               "Refused: " ++ Reason ++ "."
        end,
    AdmitEnabled = State =:= "REQUESTED" andalso DecisionAction =:= "admit",
    Illegal = fun (S) -> "Illegal from " ++ S ++ "." end,
    [#{id => "request", label => "Request",
       enabled => State =:= "FREE",
       reason => case State of "FREE" -> "FREE → REQUESTED";
                               _ -> Illegal(State) end},
     #{id => "admit", label => "Admit",
       enabled => AdmitEnabled, reason => AdmitReason},
     #{id => "reject", label => "Reject",
       enabled => State =:= "REQUESTED",
       reason => case State of "REQUESTED" -> "REQUESTED → FREE";
                               _ -> Illegal(State) end},
     #{id => "timeout", label => "Timeout",
       enabled => State =:= "REQUESTED",
       reason => case State of "REQUESTED" -> "REQUESTED → FREE";
                               _ -> Illegal(State) end},
     #{id => "reserve", label => "Reserve",
       enabled => State =:= "ADMITTED",
       reason => case State of
                     "ADMITTED" ->
                         "Lock " ++ format_bps(maps:get(requested_bps, C)) ++
                         " on " ++ path_label(maps:get(path, C)) ++ ".";
                     _ -> Illegal(State)
                 end},
     #{id => "install", label => "Install",
       enabled => State =:= "RESERVED",
       reason => case State of "RESERVED" -> "Write forwarding entries.";
                               _ -> Illegal(State) end},
     #{id => "install-fault", label => "Fault last hop",
       enabled => State =:= "RESERVED" andalso length(maps:get(path, C)) > 1,
       reason => case State of
                     "RESERVED" -> "Rollback test. Not a measured hardware fault.";
                     _ -> Illegal(State)
                 end},
     #{id => "activate", label => "Activate",
       enabled => State =:= "INSTALLED",
       reason => case State of "INSTALLED" -> "INSTALLED → ACTIVE";
                               _ -> Illegal(State) end},
     #{id => "drain", label => "Drain",
       enabled => State =:= "ACTIVE",
       reason => case State of "ACTIVE" -> "ACTIVE → DRAINING";
                               _ -> Illegal(State) end},
     #{id => "release", label => "Release",
       enabled => State =:= "DRAINING" orelse State =:= "FAILED",
       reason => case State of
                     S when S =:= "DRAINING" orelse S =:= "FAILED" ->
                         "Return bandwidth once and post the final event.";
                     _ -> Illegal(State)
                 end},
     #{id => "fail", label => "Fail",
       enabled => State =/= "FREE" andalso State =/= "REQUESTED" andalso
                  State =/= "RELEASED" andalso State =/= "FAILED",
       reason => case State of
                     "REQUESTED" ->
                         "spec/state_machine.md has no REQUESTED → FAILED. Use reject or timeout. TLA+ is looser; this console follows the spec.";
                     _ -> "Explicit failure. Bandwidth, if held, stays held."
                 end},
     #{id => "recycle", label => "Recycle",
       enabled => State =:= "RELEASED",
       reason => case State of "RELEASED" -> "RELEASED → FREE";
                               _ -> Illegal(State) end}].
