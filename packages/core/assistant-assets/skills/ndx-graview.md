Run the product map, the Graview face over this project's PRD, analysis and runs, and report what it shows and what is wrong with it.

1. Run `ndx graview info .` and keep what it reports:
   - `graview:` — the graview binary and where it was found;
   - `face:` — the product face, the `graview-face` extension (`@n-dx/graview-face`), and whether it is installed and enabled;
   - `rex:` — the hub's rex endpoint, which the face writes back through.

   If no graview binary is found, or the face is missing or not enabled, report the fix `info` names on that line and stop. If `rex:` reads "not registered with the hub", say the map will be read-only until `ndx start .` runs, and carry on.
2. Run `ndx graview check .`.
   - It emits the projection, checks the declaration, and checks that the emitted snapshot fits it.
   - Keep the counts line ("Wrote … areas, … capabilities, …") and every misfit it lists.
   - A misfit names a node or an edge the declaration does not admit, and the face would fail on it. Note it; do not try to fix it in this run.
   - If the project has no sourcevision analysis, the zone pages and the code map will be empty; say that `ndx analyze .` fills them.
3. Start the face in the background: `ndx graview serve .`.
   - `ndx graview serve` runs until it is stopped, so never run it in the foreground.
   - It takes port 5188, or the next free one when another project's face holds 5188. Read the URL it prints once it listens (its `Local:` line) and use that one.
   - If it exits instead, report its output and stop.
4. Walk the face at that URL. Use a browser tool if one is available; otherwise fetch each page and say the pages were not seen rendered. Check these pages:
   - home;
   - Needs attention and the Inbox;
   - Areas and one area;
   - one capability;
   - one zone page, and its code map;
   - Runs and Spend.

   On each page, note anything empty that the counts from step 2 say should not be, any error, and anything unreadable. Check both colour schemes when the tool can switch them.
5. Report:
   - the URL;
   - whether writes sync, from step 1;
   - the counts and misfits, from step 2;
   - what each page showed, from step 4;
   - each problem in one line, with the page it is on.

## Done when

The report is presented. Leave the face running so the user can look, and say how to stop it: end the background `ndx graview serve` this run started. This skill only reads and serves. It does not change code, the declaration or the PRD, and it does not capture the problems it found; turning a problem into a PRD item is a separate `/ndx-capture` run.
