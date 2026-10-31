%%%-------------------------------------------------------------------
%%% @doc Sovereign Circuit Fabric — console entry point.
%%%
%%% Starts the exchange (which starts circuit actors on demand) and
%%% the HTTP server. Port from SCF_PORT, default 8080.
%%%-------------------------------------------------------------------
-module(scf_console).

-export([start/0]).

start() ->
    case whereis(scf_exchange) of
        undefined -> {ok, _Pid} = scf_exchange:start_link();
        _ -> ok
    end,
    Port = case os:getenv("SCF_PORT") of
               false -> 8080;
               Text -> list_to_integer(Text)
           end,
    {ok, _} = scf_http:start(Port),
    io:format("Sovereign Circuit Fabric console: http://127.0.0.1:~B/~n",
              [Port]),
    receive after infinity -> ok end.
