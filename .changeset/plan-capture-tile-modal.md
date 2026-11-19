---
"@n-dx/web": patch
---

The dashboard's Plan page puts "Describe a change" in a tile of its own, and its **More…** opens the full form in a dialog instead of expanding the page.

The capture is no longer a bar across the top of Plan: it is the first tile, with the Inbox beneath it and Open changes beside them. Its **More…** (or the tile's header) opens the whole Add Items form, with attachments, preview, batch import, project scan and recent activity, in the same modal the other Plan tiles use. Esc, the close button and a click on the backdrop close it and return focus to **More…**. Text typed and images attached in the tile are there in the dialog, and the other way round. Capturing from either still adds one change to the Inbox, with its images, and clears both; a preview left in the other is dropped, so the change cannot be added twice. A preview started in the tile grows the tile instead of clipping it. The Add Items page on its own route now shows the full form directly, and on a v2 project it is named "Describe a change".
