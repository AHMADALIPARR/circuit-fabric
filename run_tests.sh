#!/bin/sh
# Compile every BEAM module and run the console test suite.
set -e
cd "$(dirname "$0")/beam"
erlc -o . pricing.erl circuit_actor.erl scf_model.erl scf_exchange.erl \
    scf_render.erl scf_http.erl scf_console.erl scf_console_test.erl
erl -noshell -pa . -eval 'ok = scf_console_test:run(), init:stop().'
