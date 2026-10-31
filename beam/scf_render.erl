%%%-------------------------------------------------------------------
%%% @doc Sovereign Circuit Fabric — console rendering.
%%%
%%% Server-rendered HTML and CSS only. The console ships no
%%% JavaScript: every interaction is a link or a form post, and the
%%% BEAM exchange re-renders the page. Layout, wording, and palette
%%% follow the reference console: dark ground, brass accent, a
%%% single-column measure, four tabs (Fabric, Circuits, Ledger,
%%% Evidence), and the transcript line as the footer.
%%%-------------------------------------------------------------------
-module(scf_render).

-export([page/2, css/0]).

-define(BRASS, "#d4a24c").

%%%-------------------------------------------------------------------
%%% Page shell
%%%-------------------------------------------------------------------

%% Opts: #{tab => string, sel => integer | none, arm => boolean}
page(View, Opts) ->
    Tab = maps:get(tab, Opts, "fabric"),
    Sel = maps:get(sel, Opts, none),
    Arm = maps:get(arm, Opts, false),
    Links = maps:get(links, View),
    Reserved = lists:sum([maps:get(reserved_bps, L) || L <- Links]),
    Capacity = lists:sum([maps:get(capacity_bps, L) || L <- Links]),
    Invariants = scf_model:check_invariants(View),
    Broken = lists:any(fun (I) -> not maps:get(ok, I) end, Invariants),
    Transcript = maps:get(transcript, View),
    Last = case Transcript of
               [] -> none;
               _ -> lists:last(Transcript)
           end,
    Body = case Tab of
               "circuits" -> circuits_view(View, Sel);
               "ledger" -> ledger_view(View);
               "evidence" -> evidence_view(View, Invariants, Arm);
               _ -> fabric_view(View)
           end,
    Html = ["<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">",
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
            "<title>Sovereign Circuit Fabric</title>",
            "<link rel=\"stylesheet\" href=\"/style.css\"></head><body>",
            "<main class=\"wrap\">",
            header(View, Reserved, Capacity, Broken),
            tabbar(Tab),
            "<div class=\"content\">", Body, "</div>",
            footer(Last),
            "</main></body></html>"],
    unicode:characters_to_binary(Html).

header(View, Reserved, Capacity, Broken) ->
    Pct = case Capacity of
              0 -> 0;
              _ -> min(100, Reserved * 100 div Capacity)
          end,
    ["<header class=\"head\">",
     "<div class=\"head-row\"><div class=\"head-title\">",
     "<p class=\"kicker\">SCF · NS 0</p>",
     "<h1>Sovereign<span class=\"block\">Circuit Fabric</span></h1>",
     "<p class=\"sub\">Phase I model, running here on BEAM. Toolchains not executed.</p>",
     "</div>",
     cmd_form(#{type => "tick"}, View, "fabric", none,
              "<button type=\"submit\" class=\"btn-primary\">+1 s</button>"),
     "</div>",
     "<div class=\"meter-row\"><div class=\"meter-labels mono\">",
     "<span class=\"muted\">t = ", int(maps:get(seconds, View)), " s</span>",
     "<span>", esc(scf_model:format_bps(Reserved)),
     "<span class=\"muted\"> / ", esc(scf_model:format_bps(Capacity)), "</span></span>",
     "</div><div class=\"bar\"><div class=\"bar-fill\" style=\"width:",
     int(Pct), "%\"></div></div></div>",
     case Broken of
         true -> "<p class=\"warn\">Stored state breaks an invariant. Reset it from Evidence.</p>";
         false -> ""
     end,
     "</header>"].

tabbar(Active) ->
    Tabs = [{"fabric", "Fabric", icon_waypoints()},
            {"circuits", "Circuits", icon_cable()},
            {"ledger", "Ledger", icon_scroll()},
            {"evidence", "Evidence", icon_badge()}],
    ["<nav class=\"tabs\" aria-label=\"Exchange sections\">",
     [["<a class=\"tab", case T =:= Active of true -> " active"; false -> "" end,
       "\" href=\"/?tab=", T, "\">", Icon, "<span>", Label, "</span></a>"]
      || {T, Label, Icon} <- Tabs],
     "</nav>"].

footer(none) -> "<footer class=\"foot\"></footer>";
footer(Last) ->
    Result = maps:get(result, Last),
    Cls = case Result of "error" -> "fg"; _ -> "brass" end,
    ["<footer class=\"foot\" aria-live=\"polite\">",
     "<p class=\"mono foot-line\"><span class=\"", Cls, "\">", esc(Result),
     "</span><span class=\"muted\"> · ", esc(maps:get(command, Last)), "</span>",
     "<span class=\"block\">", esc(maps:get(detail, Last)), "</span></p></footer>"].

%%%-------------------------------------------------------------------
%%% Shared form helper: every command posts to /cmd with the current
%%% transaction id, and returns to a tab/selection after the redirect.
%%%-------------------------------------------------------------------

cmd_form(Fields, View, Tab, Sel, Inner) ->
    TxId = "tx-" ++ int(maps:get(next_tx, View)),
    ["<form method=\"post\" action=\"/cmd\" class=\"inline-form\">",
     hidden("txid", TxId),
     hidden("tab", Tab),
     case Sel of
         none -> "";
         _ -> hidden("sel", int(Sel))
     end,
     [hidden(K, V) || {K, V} <- field_pairs(Fields)],
     Inner,
     "</form>"].

field_pairs(Fields) ->
    maps:fold(
      fun (type, V, Acc) -> [{"type", V} | Acc];
          (cid, V, Acc) -> [{"cid", int(V)} | Acc];
          (link_id, V, Acc) -> [{"link_id", V} | Acc];
          (fault_hop, V, Acc) -> [{"fh", int(V)} | Acc];
          (reason, V, Acc) -> [{"reason", V} | Acc];
          (_K, _V, Acc) -> Acc
      end, [], Fields).

hidden(Name, Value) ->
    ["<input type=\"hidden\" name=\"", Name, "\" value=\"", esc(Value), "\">"].

%%%-------------------------------------------------------------------
%%% Fabric tab
%%%-------------------------------------------------------------------

fabric_view(View) ->
    Links = maps:get(links, View),
    Circuits = maps:get(circuits, View),
    ["<div class=\"stack\">",
     fabric_svg(Links),
     "<p class=\"note\">Reference capacities, not a measured link. Edge links 10 Mb/s. Backbone W–E 20 Mb/s. A down link keeps existing reservations until release.</p>",
     "<ul class=\"stack\">",
     [link_card(L, Circuits, View) || L <- Links],
     "</ul>",
     "<section class=\"card\">",
     "<h2>Try the conservation rules</h2>",
     "<ol class=\"try\">",
     "<li>Open two W→E circuits at 12 Mb/s. Admit both, then reserve. The second reserve must fail.</li>",
     "<li>Activate one, inject a frame, then inject a bad magic. Only the good frame counts.</li>",
     "<li><a class=\"brass-link\" href=\"/?tab=evidence\">Run the pricing.erl vector</a> and read the ledger. The published total is 0.2500.</li>",
     "</ol></section>",
     "</div>"].

fabric_svg(Links) ->
    Pos = #{"N" => {160, 42}, "E" => {274, 148},
            "S" => {160, 254}, "W" => {46, 148}},
    Lines = [svg_line(L, Pos) || L <- Links],
    Nodes = [svg_node(N, Pos) || N <- ["N", "E", "S", "W"]],
    ["<svg viewBox=\"0 0 320 296\" class=\"fabric\" role=\"img\" aria-label=\"Four-node reference fabric\">",
     Lines, Nodes, "</svg>"].

svg_line(L, Pos) ->
    {X1, Y1} = maps:get(maps:get(a, L), Pos),
    {X2, Y2} = maps:get(maps:get(b, L), Pos),
    Down = maps:get(down, L),
    Util = case maps:get(capacity_bps, L) of
               0 -> 0;
               Cap -> maps:get(reserved_bps, L) / Cap
           end,
    Stroke = case Down of true -> "#8e947f"; false -> ?BRASS end,
    Width = case maps:get(reserved_bps, L) > 0 of
                true -> "4";
                false -> "1.5"
            end,
    Dash = case Down of
               true -> " stroke-dasharray=\"5 4\"";
               false -> ""
           end,
    Opacity = case Down of
                  true -> "0.7";
                  false -> io_lib:format("~.2f", [0.35 + Util * 0.65])
              end,
    ["<line x1=\"", int(X1), "\" y1=\"", int(Y1),
     "\" x2=\"", int(X2), "\" y2=\"", int(Y2),
     "\" stroke=\"", Stroke, "\" stroke-width=\"", Width,
     "\"", Dash, " opacity=\"", Opacity, "\"/>"].

svg_node(N, Pos) ->
    {X, Y} = maps:get(N, Pos),
    ["<g><circle cx=\"", int(X), "\" cy=\"", int(Y),
     "\" r=\"22\" fill=\"#171c17\" stroke=\"", ?BRASS, "\"/>",
     "<text x=\"", int(X), "\" y=\"", int(Y + 4),
     "\" text-anchor=\"middle\" fill=\"#e8e6dc\" font-family=\"monospace\" font-size=\"13\">",
     N, "</text></g>"].

link_card(L, Circuits, View) ->
    Holders = [C || C <- Circuits,
                    maps:get(reserved_bps, C) > 0,
                    lists:member(maps:get(id, L), maps:get(link_ids, C)),
                    maps:get(state, C) =/= "FREE",
                    maps:get(state, C) =/= "RELEASED"],
    Util = case maps:get(capacity_bps, L) of
               0 -> 0;
               Cap -> min(100, maps:get(reserved_bps, L) * 100 div Cap)
           end,
    Down = maps:get(down, L),
    Toggle = case Down of
                 true -> #{type => "restore_link", link_id => maps:get(id, L)};
                 false -> #{type => "fail_link", link_id => maps:get(id, L)}
             end,
    ["<li class=\"card\"><div class=\"link-row\"><div>",
     "<span class=\"mono block\">", esc(scf_model:link_endpoints(L)), "</span>",
     "<span class=\"muted block\">", esc(scf_model:format_bps(maps:get(reserved_bps, L))),
     " reserved · ", esc(scf_model:format_bps(maps:get(capacity_bps, L))),
     case Down of true -> " · down"; false -> "" end,
     "</span></div>",
     cmd_form(Toggle, View, "fabric", none,
              ["<button type=\"submit\" class=\"btn-ghost\">",
               case Down of true -> "Restore"; false -> "Fail link" end,
               "</button>"]),
     "</div>",
     "<div class=\"bar\"><div class=\"bar-fill\" style=\"width:", int(Util),
     "%\"></div></div>",
     case Holders of
         [] -> "";
         _ -> ["<p class=\"mono muted small\">Held by ",
               string:join(["#" ++ int(maps:get(id, C)) || C <- Holders], " "),
               "</p>"]
     end,
     "</li>"].

%%%-------------------------------------------------------------------
%%% Circuits tab
%%%-------------------------------------------------------------------

circuits_view(View, Sel) ->
    Circuits = maps:get(circuits, View),
    ["<div class=\"stack\">",
     create_form(View),
     case Circuits of
         [] -> "<p class=\"muted\">No circuits. Capacity is idle.</p>";
         _ -> ["<ul class=\"stack\">",
               [["<li>", circuit_card(C, View, Sel), "</li>"]
                || C <- Circuits],
               "</ul>"]
     end,
     "<p class=\"small muted\">Commands carry transaction ids. Replaying one does not reserve twice or post the same accounting event again.</p>",
     replay_form(View),
     "</div>"].

create_form(View) ->
    TxId = "tx-" ++ int(maps:get(next_tx, View)),
    Presets = [{100, "100 b/s", "Pricing sample"},
               {2000000, "2 Mb/s", "Fits an edge"},
               {6000000, "6 Mb/s", "Leaves a second path"},
               {12000000, "12 Mb/s", "Oversubscribes 10 Mb/s"}],
    ["<details class=\"card\" open>",
     "<summary>Open a circuit</summary>",
     "<form method=\"post\" action=\"/cmd\" class=\"stack form-pad\">",
     hidden("type", "create"), hidden("txid", TxId), hidden("tab", "circuits"),
     "<div class=\"grid2\">",
     select_field("Source", "src", "N"),
     select_field("Destination", "dst", "S"),
     "</div>",
     "<fieldset><legend>Bandwidth</legend><div class=\"grid2\">",
     [["<label class=\"pick\"><input type=\"radio\" name=\"bps\" value=\"",
       int(B), "\"", case B =:= 2000000 of true -> " checked"; false -> "" end,
       "><span class=\"pick-body\"><span class=\"block\">", Label, "</span>",
       "<span class=\"block small muted-note\">", Note, "</span></span></label>"]
      || {B, Label, Note} <- Presets],
     "</div></fieldset>",
     "<fieldset><legend>Priority 3</legend>",
     "<div class=\"grid8\">",
     [["<label class=\"pick pick-sm\"><input type=\"radio\" name=\"priority\" value=\"",
       int(P), "\"", case P =:= 3 of true -> " checked"; false -> "" end,
       "><span class=\"pick-body center\">", int(P), "</span></label>"]
      || P <- lists:seq(0, 7)],
     "</div></fieldset>",
     "<label class=\"fld\">QoS class 0–15",
     "<input class=\"field\" type=\"number\" name=\"qos\" min=\"0\" max=\"15\" value=\"1\">",
     "</label>",
     "<fieldset class=\"stack\"><legend>Tariff locked at admission</legend>",
     [["<label class=\"pick\"><input type=\"radio\" name=\"tariff_id\" value=\"",
       int(maps:get(id, T)), "\"",
       case maps:get(id, T) =:= 1 of true -> " checked"; false -> "" end,
       "><span class=\"pick-body\"><span class=\"block medium\">",
       esc(maps:get(name, T)), " · v", int(maps:get(version, T)), "</span>",
       "<span class=\"block small muted-note\">Setup ", int(maps:get(setup, T)),
       " minor · ", int(maps:get(rate_bps, T)), "/bps/s · ",
       int(maps:get(rate_byte, T)), "/byte · priority ×",
       int(maps:get(prio_mult, T)), "/100</span></span></label>"]
      || T <- maps:get(tariffs, View)],
     "</fieldset>",
     "<button type=\"submit\" class=\"btn-primary\">Create in FREE</button>",
     "</form></details>"].

select_field(Label, Name, Default) ->
    ["<label class=\"fld\">", Label, "<select class=\"field\" name=\"", Name, "\">",
     [["<option value=\"", N, "\"",
       case N =:= Default of true -> " selected"; false -> "" end,
       ">", N, "</option>"] || N <- ["N", "E", "S", "W"]],
     "</select></label>"].

replay_form(View) ->
    Transcript = maps:get(transcript, View),
    TxLines = [L || L <- Transcript,
                    lists:prefix("tx-", maps:get(tx_id, L))],
    case TxLines of
        [] -> "";
        _ ->
            LastTx = maps:get(tx_id, lists:last(TxLines)),
            ["<form method=\"post\" action=\"/cmd\" class=\"inline-form\">",
             hidden("type", "tick"), hidden("txid", LastTx),
             hidden("tab", "circuits"),
             "<button type=\"submit\" class=\"btn-ghost\">Replay last tx</button>",
             "</form>"]
    end.

circuit_card(C, View, Sel) ->
    Id = maps:get(id, C),
    Open = Sel =:= Id,
    State = maps:get(state, C),
    Options = scf_model:actions_for(View, C),
    Happy = ["request", "admit", "reserve", "install", "activate",
             "drain", "release", "recycle"],
    Enabled = [O || O <- Options, maps:get(enabled, O)],
    Primary = first_happy(Happy, Enabled),
    Secondary = [O || O <- Enabled, O =/= Primary],
    Decision = case State of
                   "REQUESTED" ->
                       scf_model:decide(maps:get(links, View),
                                        maps:get(tariffs, View), C);
                   _ -> maps:get(decision, C)
               end,
    Owed = settlement(View, C),
    Frame = case maps:get(last_frame, View) of
                none -> none;
                LF -> case maps:get(circuit_id, LF) =:= Id of
                          true -> LF;
                          false -> none
                      end
            end,
    ["<article class=\"", case Open of true -> "card card-open"; false -> "card" end, "\">",
     "<a class=\"card-head\" href=\"/?tab=circuits&sel=", int(Id), "\">",
     "<span><span class=\"mono block\">#", int(Id), " · ",
     esc(maps:get(src, C)), "→", esc(maps:get(dst, C)), "</span>",
     "<span class=\"muted block\">", esc(scf_model:format_bps(maps:get(requested_bps, C))),
     " · p", int(maps:get(priority, C)), " · q", int(maps:get(qos, C)),
     case maps:get(path, C) of
         [] -> "";
         Path -> " · " ++ esc(scf_model:path_label(Path))
     end,
     "</span></span>",
     state_mark(State),
     "</a>",
     case Open of
         false -> "";
         true -> card_detail(C, View, Primary, Secondary, Decision, Owed, Frame)
     end,
     "</article>"].

first_happy([], _Enabled) -> none;
first_happy([H | Rest], Enabled) ->
    case [O || O <- Enabled, maps:get(id, O) =:= H] of
        [O] -> O;
        [] -> first_happy(Rest, Enabled)
    end.

settlement(View, C) ->
    Events = [E || E <- maps:get(ledger, View),
                   maps:get(circuit_id, E) =:= maps:get(id, C),
                   maps:get(lifecycle, E) =:= maps:get(lifecycle, C)],
    case Events of
        [] -> none;
        _ -> lists:sum([maps:get(amount, E) || E <- Events])
    end.

state_mark(State) ->
    Tone = if State =:= "ACTIVE" orelse State =:= "RESERVED" orelse
              State =:= "INSTALLED" -> "mark-hot";
              State =:= "FAILED" orelse State =:= "RELEASED" -> "mark-term";
              true -> "mark-idle"
           end,
    ["<span class=\"mark ", Tone, "\">", esc(State), "</span>"].

card_detail(C, View, Primary, Secondary, Decision, Owed, Frame) ->
    Lock = maps:get(tariff_lock, C),
    TariffText = case Lock of
                     none -> "T" ++ int(maps:get(tariff_id, C)) ++ " unlocked";
                     _ -> "T" ++ int(maps:get(id, Lock)) ++ " v" ++
                          int(maps:get(version, Lock)) ++ " locked"
                 end,
    ["<div class=\"stack card-detail\">",
     "<dl class=\"pairs\">",
     pair("Held", scf_model:format_bps(maps:get(reserved_bps, C))),
     pair("Duration", int(maps:get(duration_s, C)) ++ " s"),
     pair("Sent", int(maps:get(bytes_sent, C)) ++ " B · " ++
          int(maps:get(packets_sent, C)) ++ " pkt"),
     pair("Lifecycle", int(maps:get(lifecycle, C))),
     pair("Tariff", TariffText),
     pair("This lifecycle",
          case Owed of
              none -> "—";
              _ -> scf_model:format_minor(Owed)
          end),
     "</dl>",
     case Decision of
         none -> "";
         _ ->
             ["<p class=\"mono muted small\">decision ",
              esc(maps:get(action, Decision)), " · ",
              esc(maps:get(reason_code, Decision)),
              case maps:get(path, Decision) of
                  [] -> "";
                  P -> " · " ++ esc(scf_model:path_label(P))
              end,
              case maps:get(action, Decision) of
                  "reroute" -> " · alternative is not applied. The state machine has no reroute transition.";
                  _ -> ""
              end,
              "</p>"]
     end,
     case maps:get(entries, C) of
         [] -> "";
         Entries ->
             ["<ul class=\"mono muted small\">",
              [["<li>", esc(maps:get(node, E)), " ",
                esc(maps:get(ingress, E)), "→", esc(maps:get(egress, E)),
                "</li>"] || E <- Entries],
              "</ul>"]
     end,
     "<div class=\"btn-row\">",
     case Primary of
         none -> "";
         _ -> action_btn(Primary, C, View, "btn-primary")
     end,
     [action_btn(O, C, View, "btn-ghost") || O <- Secondary],
     "</div>",
     case Primary of
         none -> "";
         _ -> ["<p class=\"small muted\">", esc(maps:get(reason, Primary)), "</p>"]
     end,
     case maps:get(state, C) of
         "ACTIVE" -> inject_form(C, View);
         _ -> ""
     end,
     case Frame of
         none -> "";
         _ -> frame_dump(Frame)
     end,
     "</div>"].

pair(Label, Value) ->
    ["<div><dt class=\"muted small\">", Label, "</dt>",
     "<dd class=\"mono small\">", esc(Value), "</dd></div>"].

action_btn(Option, C, View, Class) ->
    ActionId = maps:get(id, Option),
    Fields = case ActionId of
                 "install-fault" ->
                     #{type => "install", cid => maps:get(id, C),
                       fault_hop => max(0, length(maps:get(path, C)) - 1)};
                 "fail" ->
                     #{type => "fail", cid => maps:get(id, C),
                       reason => "OPERATOR"};
                 _ ->
                     #{type => ActionId, cid => maps:get(id, C)}
             end,
    cmd_form(Fields, View, "circuits", maps:get(id, C),
             ["<button type=\"submit\" class=\"", Class, "\">",
              esc(maps:get(label, Option)), "</button>"]).

inject_form(C, View) ->
    TxId = "tx-" ++ int(maps:get(next_tx, View)),
    ["<form method=\"post\" action=\"/cmd\" class=\"stack inject\">",
     hidden("type", "inject"), hidden("txid", TxId), hidden("tab", "circuits"),
     hidden("sel", int(maps:get(id, C))), hidden("cid", int(maps:get(id, C))),
     "<label class=\"fld\">Payload bytes",
     "<input class=\"field\" type=\"number\" name=\"payload_bytes\" min=\"0\" max=\"2048\" value=\"64\">",
     "</label>",
     "<div class=\"btn-row\">",
     "<button type=\"submit\" class=\"btn-primary\">Inject data</button>",
     "<button type=\"submit\" class=\"btn-ghost\" name=\"corrupt\" value=\"magic\">Bad magic</button>",
     "<button type=\"submit\" class=\"btn-ghost\" name=\"corrupt\" value=\"checksum\">Bad checksum</button>",
     "</div></form>"].

frame_dump(Frame) ->
    Hex = maps:get(hex, Frame),
    Header = scf_model:hex_groups(lists:sublist(Hex, 40)),
    Payload = scf_model:hex_groups(lists:nthtail(min(40, length(Hex)), Hex)),
    ["<div class=\"frame-dump\">",
     "<p class=\"mono small\">",
     case maps:get(accepted, Frame) of true -> "ACCEPTED"; false -> "DROPPED" end,
     " · ", esc(maps:get(reason, Frame)), "</p>",
     "<p class=\"mono small brass break\">", esc(Header), "</p>",
     case Payload of
         "" -> "";
         _ -> ["<p class=\"mono small muted break\">", esc(Payload), "</p>"]
     end,
     "<p class=\"small muted\">20-byte header, then payload. Magic is 0x5343, the ASCII encoding of “SC”, set in the corrected spec. The original spec literal 0xSCF1 was not hexadecimal.</p>",
     "</div>"].

%%%-------------------------------------------------------------------
%%% Ledger tab
%%%-------------------------------------------------------------------

ledger_view(View) ->
    Ledger = maps:get(ledger, View),
    Total = lists:sum([maps:get(amount, E) || E <- Ledger]),
    T1 = hd(maps:get(tariffs, View)),
    TxId = "tx-" ++ int(maps:get(next_tx, View)),
    ["<div class=\"stack\">",
     "<section class=\"card\">",
     "<p class=\"small muted\">Posted minor units · 1/10000</p>",
     "<p class=\"mono total\">", esc(scf_model:format_minor(Total)), "</p>",
     "<p class=\"note\">Setup posts at admission. Reservation posts once per clock second while bandwidth is held, including FAILED. Usage and priority post once, on release.</p>",
     "</section>",
     [["<section class=\"card plain\">",
       "<h2>", esc(maps:get(name, T)), " · v", int(maps:get(version, T)), "</h2>",
       "<p class=\"note\">", esc(maps:get(origin, T)), "</p>",
       "<p class=\"mono small muted\">setup ", int(maps:get(setup, T)),
       " · rate ", int(maps:get(rate_bps, T)), "/bps/s · byte ",
       int(maps:get(rate_byte, T)), " · prio ", int(maps:get(prio_mult, T)),
       "</p></section>"]
      || T <- maps:get(tariffs, View)],
     "<form method=\"post\" action=\"/cmd\" class=\"stack\">",
     hidden("type", "revise_tariff"), hidden("txid", TxId),
     hidden("tab", "ledger"), hidden("tariff_id", "1"),
     "<label class=\"fld\">New T1 setup fee, minor units",
     "<input class=\"field\" type=\"number\" name=\"setup\" min=\"0\" value=\"",
     int(maps:get(setup, T1)), "\"></label>",
     "<button type=\"submit\" class=\"btn-ghost\">Publish T1 version</button>",
     "<p class=\"small muted\">Circuits already admitted keep the version they locked.</p>",
     "</form>",
     case Ledger of
         [] -> "<p class=\"muted\">No accounting events yet.</p>";
         _ ->
             ["<ul>",
              [ledger_row(E) || E <- lists:reverse(Ledger)],
              "</ul>"]
     end,
     "</div>"].

ledger_row(E) ->
    ["<li class=\"ledger-row\">",
     "<div class=\"ledger-top\"><p class=\"mono small\">#",
     int(maps:get(circuit_id, E)), " · ", esc(maps:get(kind, E)),
     " · seq ", int(maps:get(seq, E)), "</p>",
     "<p class=\"mono\">", esc(scf_model:format_minor(maps:get(amount, E))),
     "</p></div>",
     "<p class=\"note\">t=", int(maps:get(second, E)), "s · lifecycle ",
     int(maps:get(lifecycle, E)), " · ", esc(maps:get(detail, E)), "</p>",
     "</li>"].

%%%-------------------------------------------------------------------
%%% Evidence tab
%%%-------------------------------------------------------------------

evidence_view(View, Invariants, Arm) ->
    ["<div class=\"stack\">",
     "<section><h2>Evidence or silence</h2>",
     "<p class=\"note\">This console executes the Phase I exchange on BEAM: the real circuit actor decides legal transitions, pricing.erl computes every charge, and the frame codec runs here. A passing row below is a property of this running model. It is not a Why3 discharge, a p4c run, or a synthesis report.</p></section>",
     cmd_form(#{type => "pricing_vector"}, View, "evidence", none,
              "<button type=\"submit\" class=\"btn-primary\">Reproduce pricing.erl vector</button>"),
     "<section><h2>What was actually run</h2><ul class=\"claims\">",
     [["<li><p>", Title, "</p><p class=\"note\">", Body, "</p></li>"]
      || {Title, Body} <- claims()],
     "</ul></section>",
     "<section><h2>Invariants of this model</h2><ul>",
     [["<li class=\"inv-row\"><span class=\"mono small ",
       case maps:get(ok, I) of true -> "brass"; false -> "fg" end,
       "\">", case maps:get(ok, I) of true -> "PASS"; false -> "FAIL" end,
       "</span><span><span class=\"mono small block\">", esc(maps:get(id, I)),
       "</span><span class=\"note block\">", esc(maps:get(detail, I)),
       "</span></span></li>"]
      || I <- Invariants],
     "</ul></section>",
     "<section class=\"note-block\">",
     "<p><span class=\"fg\">spec/README.md</span> named circuit_id.md and invariants.md. Both were authored from the existing definitions during the baseline alignment and are in the source repository.</p>",
     "<p>Magic was written as 0xSCF1. S is not a hexadecimal digit. The baseline set the value to 0x5343, the ASCII encoding of “SC”, in the spec and the P4 parser. Frames here use 0x5343.</p>",
     "<p>The TLA+ model's Fail action is generic and the model has no Timeout action; the spec table restricts fail and defines timeout. The actor and this console follow the spec. Model alignment is Phase II TLA+ work.</p>",
     "<p><a class=\"brass-link\" href=\"https://github.com/AHMADALIPARR/sovereign-circuit-fabric\">Source repository</a></p>",
     "</section>",
     case Arm of
         true ->
             cmd_form(#{type => "reset"}, View, "evidence", none,
                      "<button type=\"submit\" class=\"btn-ghost\">Confirm reset</button>");
         false ->
             "<a class=\"btn-ghost btn-link\" href=\"/?tab=evidence&arm=1\">Reset exchange</a>"
     end,
     "</div>"].

claims() ->
    [{"Phase I definitions",
      "Executing on BEAM in this console. State machine, resource conservation, tariff formula, frame layout."},
     {"control/beam/circuit_actor.erl",
      "Executing. One gen_statem process per circuit decides transition legality. Resource reservation is performed here, in the orchestration layer, as the actor's contract states."},
     {"accounting/pricing.erl",
      "Executing. Its exported components compute every charge in this console; nothing is transcribed. basic_charge_test constants are T1. Expected settlement is 2500 minor units."},
     {"TLA+ CircuitState.tla",
      "TLC ran against the committed model and configuration in the source repository: 6,271 generated states, 1,650 distinct. TypeOK, NoOverCommit, ReservedOnlyWhenHeld, and FreeHasZero hold."},
     {"WhyML / Why3 and Dafny",
      "Not discharged. Phase II work, in that order: Why3 arithmetic and capacity proofs, then Dafny contracts."},
     {"P4_16 circuit_forward.p4",
      "Source only. p4c was not run. The header layout was verified field-for-field against the corrected spec: 160 bits, network order, magic 0x5343."},
     {"VHDL scf_crossbar",
      "Source only. No GHDL log. No resource or timing numbers."},
     {"Gödel",
      "Blocked. No compiler. Admission here executes the relations in control/godel/README.md as Erlang. It is not a Gödel execution."},
     {"UUIE-Array accounting extension",
      "The C11 engine in the source repository passes its 117-check acceptance suite under ASan/UBSan. It is not wired into this console."}].

%%%-------------------------------------------------------------------
%%% Icons (inline SVG, stroke style of the reference console)
%%%-------------------------------------------------------------------

icon_waypoints() ->
    "<svg class=\"icon\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"4.5\" r=\"2.5\"/><path d=\"m10.2 6.3 3.1 3.1\"/><circle cx=\"4.5\" cy=\"12\" r=\"2.5\"/><path d=\"M7 12h3.5\"/><circle cx=\"12\" cy=\"19.5\" r=\"2.5\"/><path d=\"m13.8 17.7-3.1-3.1\"/><circle cx=\"19.5\" cy=\"12\" r=\"2.5\"/><path d=\"M17 12h-3.5\"/></svg>".

icon_cable() ->
    "<svg class=\"icon\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 2v6\"/><path d=\"M15 2v6\"/><path d=\"M12 8v2\"/><path d=\"M5 10h14v3a7 7 0 0 1-14 0z\"/><path d=\"M12 20v2\"/></svg>".

icon_scroll() ->
    "<svg class=\"icon\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M19 17V5a2 2 0 0 0-2-2H4\"/><path d=\"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3\"/></svg>".

icon_badge() ->
    "<svg class=\"icon\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\"/><path d=\"m9 12 2 2 4-4\"/></svg>".

%%%-------------------------------------------------------------------
%%% CSS — the reference console's tokens and layout, no framework
%%%-------------------------------------------------------------------

css() ->
    unicode:characters_to_binary(
      ":root{--bg:#0e100e;--surface:#171c17;--raised:#21281f;--fg:#e8e6dc;"
      "--muted:#8e947f;--brass:#d4a24c;--brass-ink:#1a1408;--line:#31382c}"
      "*{box-sizing:border-box}"
      "body{margin:0;background:var(--bg);color:var(--fg);"
      "font-family:\"IBM Plex Sans\",ui-sans-serif,system-ui,sans-serif;line-height:1.5}"
      ":focus-visible{outline:2px solid var(--brass);outline-offset:2px}"
      "button,a,summary{cursor:pointer}"
      ".wrap{margin:0 auto;width:100%;max-width:32rem;min-height:100dvh;display:flex;flex-direction:column}"
      ".mono{font-family:\"IBM Plex Mono\",ui-monospace,monospace}"
      ".muted{color:var(--muted)}.brass{color:var(--brass)}.fg{color:var(--fg)}"
      ".block{display:block}.small{font-size:.75rem}.note{font-size:.875rem;color:var(--muted)}"
      ".head{border-top:2px solid var(--brass);padding:1rem 1rem .75rem}"
      ".head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem}"
      ".kicker{font-family:\"IBM Plex Mono\",ui-monospace,monospace;font-size:.75rem;letter-spacing:.1em;color:var(--brass);margin:0}"
      "h1{font-size:1.25rem;font-weight:500;line-height:1.25;letter-spacing:-.01em;margin:.25rem 0 0}"
      "h2{font-size:.875rem;font-weight:500;margin:0}"
      ".sub{font-size:.875rem;color:var(--muted);margin:.25rem 0 0}"
      ".meter-row{margin-top:1rem}"
      ".meter-labels{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem;font-size:.75rem}"
      ".bar{height:.25rem;background:var(--raised);margin-top:.5rem}"
      ".bar-fill{height:.25rem;background:var(--brass)}"
      ".warn{font-size:.875rem;margin:.75rem 0 0}"
      ".tabs{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line)}"
      ".tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.25rem;min-height:2.75rem;padding:.5rem 0;font-size:.75rem;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent}"
      ".tab.active{border-bottom-color:var(--brass);color:var(--brass)}"
      ".tab .icon{width:1rem;height:1rem}"
      ".content{flex:1;overflow-y:auto;padding:1rem}"
      ".foot{border-top:1px solid var(--line);padding:.75rem 1rem max(.75rem,env(safe-area-inset-bottom))}"
      ".foot-line{font-size:.75rem;line-height:1.6;margin:0}"
      ".stack{display:flex;flex-direction:column;gap:1rem}"
      "ul.stack,ul{list-style:none;margin:0;padding:0}"
      ".card{border:1px solid var(--line);background:var(--surface);padding:.75rem}"
      ".card.plain{background:transparent}"
      ".card-open{border-color:var(--brass)}"
      ".card-head{display:flex;width:100%;align-items:flex-start;justify-content:space-between;gap:.75rem;text-align:left;color:var(--fg);text-decoration:none}"
      ".card-detail{margin-top:.75rem}"
      "details.card summary{min-height:2.75rem;padding:.25rem 0;font-size:.875rem;font-weight:500}"
      ".form-pad{padding:.25rem 0 .25rem}"
      ".btn-primary{display:inline-flex;min-height:2.75rem;align-items:center;justify-content:center;border:0;border-radius:2px;background:var(--brass);padding:0 1rem;font-size:.875rem;font-weight:500;color:var(--brass-ink);text-decoration:none}"
      ".btn-ghost{display:inline-flex;min-height:2.75rem;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:2px;background:var(--surface);padding:0 .75rem;font-size:.875rem;color:var(--fg);text-decoration:none}"
      ".btn-row{display:flex;flex-wrap:wrap;gap:.5rem}"
      ".inline-form{display:inline}"
      ".field{min-height:2.75rem;width:100%;border-radius:2px;border:1px solid var(--line);background:var(--raised);padding:0 .75rem;font-size:1rem;color:var(--fg)}"
      ".fld{display:flex;flex-direction:column;gap:.25rem;font-size:.75rem;letter-spacing:.02em;color:var(--muted)}"
      "fieldset{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}"
      "legend{font-size:.75rem;letter-spacing:.02em;color:var(--muted);padding:0;margin-bottom:.25rem}"
      ".grid2{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}"
      ".grid8{display:grid;grid-template-columns:repeat(8,1fr);gap:.25rem}"
      ".pick{position:relative;display:block}"
      ".pick input{position:absolute;opacity:0;inset:0}"
      ".pick-body{display:block;min-height:2.75rem;border:1px solid var(--line);border-radius:2px;background:var(--surface);padding:.5rem .75rem;font-size:.875rem}"
      ".pick-body.center{text-align:center;padding:.5rem 0}"
      ".pick input:checked~.pick-body{background:var(--brass);border-color:var(--brass);color:var(--brass-ink)}"
      ".pick input:checked~.pick-body .muted-note{color:var(--brass-ink)}"
      ".pick input:focus-visible~.pick-body{outline:2px solid var(--brass);outline-offset:2px}"
      ".muted-note{color:var(--muted)}.medium{font-weight:500}"
      ".mark{flex-shrink:0;border:1px solid var(--line);padding:.25rem .5rem;font-family:\"IBM Plex Mono\",ui-monospace,monospace;font-size:.75rem;letter-spacing:.02em;color:var(--muted)}"
      ".mark-hot{border-color:var(--brass);color:var(--brass)}"
      ".mark-term{border-color:var(--fg);color:var(--fg)}"
      ".pairs{display:grid;grid-template-columns:1fr 1fr;gap:.5rem .75rem;margin:0}"
      ".pairs dt{font-size:.75rem;color:var(--muted)}"
      ".pairs dd{font-size:.75rem;margin:0}"
      ".inject{border-top:1px solid var(--line);padding-top:.75rem}"
      ".frame-dump{border-top:1px solid var(--line);padding-top:.75rem}"
      ".break{word-break:break-all;line-height:1.6}"
      ".fabric{width:100%}"
      ".link-row{display:flex;align-items:center;justify-content:space-between;gap:.75rem}"
      ".try{margin:.5rem 0 0;padding-left:1rem;display:flex;flex-direction:column;gap:.5rem;font-size:.875rem;color:var(--muted)}"
      ".brass-link{color:var(--brass)}"
      ".total{font-size:1.5rem;margin:.25rem 0 0}"
      ".ledger-row{border-top:1px solid var(--line);padding:.75rem 0}"
      ".ledger-top{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem}"
      ".claims li{border-bottom:1px solid var(--line);padding:.75rem 0}"
      ".claims p{margin:0;font-size:.875rem}"
      ".inv-row{display:flex;gap:.75rem;border-top:1px solid var(--line);padding:.75rem 0}"
      ".note-block{font-size:.875rem;color:var(--muted)}"
      ".note-block .fg{color:var(--fg)}"
      ".btn-link{width:100%}"
      "@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}").

%%%-------------------------------------------------------------------
%%% Small helpers
%%%-------------------------------------------------------------------

int(N) -> integer_to_list(N).

esc(S) ->
    E1 = string:replace(S, "&", "&amp;", all),
    E2 = string:replace(E1, "<", "&lt;", all),
    E3 = string:replace(E2, ">", "&gt;", all),
    string:replace(E3, "\"", "&quot;", all).
