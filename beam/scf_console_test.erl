%%%-------------------------------------------------------------------
%%% @doc Sovereign Circuit Fabric — console test suite.
%%%
%%% Port of the reference console's model tests, run against the
%%% BEAM exchange: every step drives real circuit_actor processes
%%% and pricing.erl, and the invariant suite must hold after every
%%% successful command. Plain runner module (no eunit dependency):
%%% run/0 returns ok or raises on the first failed check.
%%%-------------------------------------------------------------------
-module(scf_console_test).

-export([run/0]).

run() ->
    Tests = [fun pricing_module_vector/0,
             fun charge_breakdown_matches_pricing/0,
             fun formats/0,
             fun lifecycle_conservation_replay/0,
             fun partial_install_rollback/0,
             fun frame_codec/0,
             fun pricing_vector_command/0,
             fun tariff_revision_keeps_lock/0,
             fun illegal_transition_refused/0],
    lists:foreach(
      fun (T) ->
              fresh(),
              T(),
              io:format("ok - ~p~n", [element(2, erlang:fun_info(T, name))])
      end, Tests),
    stop_exchange(),
    io:format("scf_console_test: all ~B tests passed~n", [length(Tests)]),
    ok.

%%%-------------------------------------------------------------------
%%% Harness
%%%-------------------------------------------------------------------

fresh() ->
    stop_exchange(),
    {ok, _} = scf_exchange:start_link(),
    put(tx_counter, 0),
    ok.

stop_exchange() ->
    case whereis(scf_exchange) of
        undefined -> ok;
        Pid ->
            unlink(Pid),
            gen_server:stop(Pid),
            ok
    end.

tx() ->
    N = get(tx_counter) + 1,
    put(tx_counter, N),
    "tx-" ++ integer_to_list(N).

cmd(Type, Fields) ->
    scf_exchange:dispatch(Fields#{type => Type, tx_id => tx()}).

run_ok(Type, Fields) ->
    {Ok, _Replay, Detail} = cmd(Type, Fields),
    assert(Ok, Detail),
    all_invariants_ok(),
    Detail.

all_invariants_ok() ->
    View = scf_exchange:snapshot(),
    Bad = [I || I <- scf_model:check_invariants(View),
                not maps:get(ok, I)],
    assert(Bad =:= [], "invariant failures: " ++ io_lib:format("~p", [Bad])),
    View.

assert(true, _Msg) -> ok;
assert(false, Msg) -> erlang:error({assertion_failed, Msg}).

assert_equal(Expected, Actual, Label) ->
    case Expected =:= Actual of
        true -> ok;
        false -> erlang:error({assert_equal_failed, Label,
                               {expected, Expected}, {actual, Actual}})
    end.

assert_contains(Haystack, Needle) ->
    case string:find(Haystack, Needle) of
        nomatch -> erlang:error({assert_contains_failed, Needle, Haystack});
        _ -> ok
    end.

circuit(View, Id) ->
    hd([C || C <- maps:get(circuits, View), maps:get(id, C) =:= Id]).

link(View, Id) ->
    hd([L || L <- maps:get(links, View), maps:get(id, L) =:= Id]).

%%%-------------------------------------------------------------------
%%% Tests
%%%-------------------------------------------------------------------

%% pricing.erl's own documented vector, through the real module.
pricing_module_vector() ->
    T = #{setup => 1000, rate_bps => 1, rate_byte => 2, prio_mult => 10},
    Total = pricing:charge(#{tariff => T, reserved_bps => 100,
                             duration_s => 10, bytes => 50, priority => 2}),
    assert_equal(2500, Total, pricing_vector).

%% The console's breakdown (pricing.erl components) sums to the
%% module's own total.
charge_breakdown_matches_pricing() ->
    Lock = #{id => 1, version => 1, setup => 1000, rate_bps => 1,
             rate_byte => 2, prio_mult => 10},
    {ok, B} = scf_model:charge(Lock, 100, 10, 50, 2),
    assert_equal(1000, maps:get(setup, B), setup),
    assert_equal(1000, maps:get(reserved, B), reserved),
    assert_equal(100, maps:get(usage, B), usage),
    assert_equal(400, maps:get(priority, B), priority),
    assert_equal(2500, maps:get(total, B), total),
    Direct = pricing:charge(#{tariff => Lock, reserved_bps => 100,
                              duration_s => 10, bytes => 50, priority => 2}),
    assert_equal(Direct, maps:get(total, B), charge_agrees_with_pricing).

formats() ->
    assert_equal("0.2500", scf_model:format_minor(2500), minor_2500),
    assert_equal("0.0000", scf_model:format_minor(0), minor_0),
    assert_equal("1.0000", scf_model:format_minor(10000), minor_10000),
    assert_equal("60 Mb/s", scf_model:format_bps(60000000), bps_60m),
    assert_equal("2 Mb/s", scf_model:format_bps(2000000), bps_2m),
    assert_equal("100 b/s", scf_model:format_bps(100), bps_100),
    assert_equal("12 Mb/s", scf_model:format_bps(12000000), bps_12m).

lifecycle_conservation_replay() ->
    run_ok(create, #{src => "W", dst => "E", bps => 12000000,
                     priority => 3, qos => 1, tariff_id => 1}),
    run_ok(create, #{src => "W", dst => "E", bps => 12000000,
                     priority => 1, qos => 0, tariff_id => 1}),
    run_ok(request, #{cid => 1}),
    run_ok(request, #{cid => 2}),
    run_ok(admit, #{cid => 1}),
    run_ok(admit, #{cid => 2}),
    View0 = scf_exchange:snapshot(),
    assert_equal(["W", "E"], maps:get(path, circuit(View0, 1)), path_1),
    assert_equal(["W", "E"], maps:get(path, circuit(View0, 2)), path_2),
    ReserveTx = tx(),
    {true, false, _} = scf_exchange:dispatch(
                         #{type => reserve, tx_id => ReserveTx, cid => 1}),
    all_invariants_ok(),
    {false, false, FailDetail} = cmd(reserve, #{cid => 2}),
    assert_contains(FailDetail, "NO_CAPACITY"),
    View1 = all_invariants_ok(),
    assert_equal(12000000, maps:get(reserved_bps, link(View1, "W-E")),
                 we_reserved),
    {true, true, _} = scf_exchange:dispatch(
                        #{type => reserve, tx_id => ReserveTx, cid => 1}),
    View2 = scf_exchange:snapshot(),
    assert_equal(12000000, maps:get(reserved_bps, link(View2, "W-E")),
                 we_reserved_after_replay),
    run_ok(install, #{cid => 1}),
    run_ok(activate, #{cid => 1}),
    run_ok(inject, #{cid => 1, payload_bytes => 64}),
    View3 = scf_exchange:snapshot(),
    assert_equal(1, maps:get(packets_sent, circuit(View3, 1)), packets_1),
    {false, false, MagicDetail} = cmd(inject, #{cid => 1, payload_bytes => 8,
                                                corrupt => "magic"}),
    assert_contains(MagicDetail, "MAGIC"),
    View4 = scf_exchange:snapshot(),
    assert_equal(1, maps:get(packets_sent, circuit(View4, 1)),
                 packets_after_bad_magic),
    run_ok(drain, #{cid => 1}),
    {false, false, DropDetail} = cmd(inject, #{cid => 1, payload_bytes => 4}),
    assert_contains(DropDetail, "ADMISSION_DRAINING"),
    run_ok(release, #{cid => 1}),
    View5 = scf_exchange:snapshot(),
    assert_equal(0, maps:get(reserved_bps, link(View5, "W-E")),
                 we_released),
    {false, false, _} = cmd(release, #{cid => 1}),
    Finals = [E || E <- maps:get(ledger, View5),
                   maps:get(kind, E) =:= "FINAL",
                   maps:get(circuit_id, E) =:= 1],
    assert_equal(1, length(Finals), final_once),
    ok.

partial_install_rollback() ->
    run_ok(create, #{src => "N", dst => "S", bps => 2000000,
                     priority => 0, qos => 0, tariff_id => 2}),
    run_ok(request, #{cid => 1}),
    run_ok(admit, #{cid => 1}),
    run_ok(reserve, #{cid => 1}),
    Detail = run_ok(install, #{cid => 1, fault_hop => 2}),
    assert_contains(Detail, "PARTIAL_INSTALL at hop 2 (S)"),
    View = scf_exchange:snapshot(),
    C = circuit(View, 1),
    assert_equal("FAILED", maps:get(state, C), state_failed),
    assert_equal([], maps:get(entries, C), entries_rolled_back),
    assert_equal(2000000, maps:get(reserved_bps, C), bandwidth_held),
    SomeReserved = lists:any(
                     fun (L) -> maps:get(reserved_bps, L) =:= 2000000 end,
                     maps:get(links, View)),
    assert(SomeReserved, "a link still holds 2 Mb/s"),
    run_ok(release, #{cid => 1}),
    View2 = scf_exchange:snapshot(),
    AllZero = lists:all(
                fun (L) -> maps:get(reserved_bps, L) =:= 0 end,
                maps:get(links, View2)),
    assert(AllZero, "all links released"),
    ok.

frame_codec() ->
    Payload = <<1, 2, 3, 4, 5>>,
    Frame = scf_model:encode_frame(
              #{circuit_id => 7, priority => 3, qos => 1, sequence => 9},
              Payload),
    assert_equal(25, byte_size(Frame), frame_size),
    <<B0, B1, _/binary>> = Frame,
    assert_equal(16#53, B0, magic_hi),
    assert_equal(16#43, B1, magic_lo),
    assert(scf_model:checksum_valid(Frame), "checksum valid"),
    Parsed = scf_model:parse_frame(Frame),
    assert_equal(7, maps:get(circuit_id, Parsed), parsed_circuit),
    assert_equal(5, maps:get(payload_length, Parsed), parsed_length),
    assert_equal(9, maps:get(sequence, Parsed), parsed_sequence),
    ok.

pricing_vector_command() ->
    {true, false, Detail} = scf_exchange:dispatch(
                              #{type => pricing_vector, tx_id => "tx-1"}),
    assert_contains(Detail, "settled 2500 minor"),
    View = all_invariants_ok(),
    Events = [E || E <- maps:get(ledger, View),
                   maps:get(circuit_id, E) =:= 1],
    Total = lists:sum([maps:get(amount, E) || E <- Events]),
    assert_equal(2500, Total, vector_total),
    Kinds = [maps:get(kind, E) || E <- Events],
    assert_equal(["ESTABLISHMENT"] ++ lists:duplicate(10, "RESERVATION")
                 ++ ["FINAL"], Kinds, vector_event_kinds),
    ok.

tariff_revision_keeps_lock() ->
    run_ok(create, #{src => "N", dst => "E", bps => 1000,
                     priority => 1, qos => 1, tariff_id => 1}),
    run_ok(request, #{cid => 1}),
    run_ok(admit, #{cid => 1}),
    View0 = scf_exchange:snapshot(),
    Lock0 = maps:get(tariff_lock, circuit(View0, 1)),
    assert_equal(1000, maps:get(setup, Lock0), lock_setup_v1),
    run_ok(revise_tariff, #{tariff_id => 1, setup => 9000}),
    View = scf_exchange:snapshot(),
    T1 = hd([T || T <- maps:get(tariffs, View), maps:get(id, T) =:= 1]),
    assert_equal(2, maps:get(version, T1), tariff_v2),
    Lock = maps:get(tariff_lock, circuit(View, 1)),
    assert_equal(1, maps:get(version, Lock), lock_still_v1),
    assert_equal(1000, maps:get(setup, Lock), lock_setup_still),
    ok.

illegal_transition_refused() ->
    run_ok(create, #{src => "N", dst => "W", bps => 10,
                     priority => 0, qos => 0, tariff_id => 1}),
    {false, false, Detail} = cmd(activate, #{cid => 1}),
    assert_contains(Detail, "Illegal transition from FREE."),
    ok.
