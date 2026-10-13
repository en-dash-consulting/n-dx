Run the product map, the Graview face over this project's PRD, analysis and runs, and report what it shows and what is wrong with it.

1. Run `ndx graview info .` and keep what it reports:
   - the graview binary;
   - the product face (`@n-dx/graview-face`, or `graview.app` in `.n-dx.json`);
   - the hub's rex endpoint, which the face writes back through;
   - `serving:`, the URL of a face that is already running.

   If no face is found, say that `@n-dx/graview-face` needs installing and stop. If rex reads "not registered with the hub", say the map will be read-only until `ndx start .` runs, and carry on.
2. Run `ndx graview check .`.
   - It emits the projection, checks the declaration, and checks that the emitted snapshot fits it.
   - Keep the counts line ("Wrote … areas, … capabilities, …") and every misfit it lists.
   - A misfit names a node or an edge the declaration does not admit, and the face would fail on it. Note it; do not try to fix it in this run.
   - If `.sourcevision/` has no analysis, the zone pages and the code map will be empty; say that `ndx analyze .` fills them.
3. If step 1 found a running face, use its URL. Otherwise start one in the background: `ndx graview serve .`.
   - It takes port 5188, or the next free one when another checkout's face holds it.
   - Wait until `ndx graview info .` shows a `serving:` URL, then use that one.
   - `ndx graview serve` runs until stopped, so never run it in the foreground.
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

   To have the dashboard start the map and link to it from its top bar, say `ndx config features.graview.productFace true .`. Without that flag, the dashboard still links a map that is already running.

## Done when

The report is presented. Leave the face running so the user can look; say how to stop it if this run started it (stop the background `ndx graview serve`). This skill only reads and serves. It does not change code, the declaration or the PRD, and it does not capture the problems it found; turning a problem into a PRD item is a separate `/ndx-capture` run.
