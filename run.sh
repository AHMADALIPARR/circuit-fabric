#!/bin/sh
# Compile and serve the console. Port: SCF_PORT (default 8080).
set -e
cd "$(dirname "$0")/beam"
erlc -o . pricing.erl circuit_actor.erl scf_model.erl scf_exchange.erl \
    scf_render.erl scf_http.erl scf_console.erl
exec erl -noshell -pa . -s scf_console start
