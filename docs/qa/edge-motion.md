# Edge movement and portrait acceptance

## Implemented

- Grip or Alt-drag uses a capsule constrained to the work-area perimeter. It rotates between horizontal and vertical forms and travels around corners rather than crossing the screen.
- No free-flight position, rubber band or release momentum. Corner hysteresis prevents rapid edge switching.
- Esc restores the saved edge/position. Failed native movement restores normal geometry and clears the drag guard; a repeated-failure regression covers starting again.
- Portrait width/height are separate saved settings. Side resizing does not overwrite landscape, chat or agent dimensions. Native windows fit the available work area, including high DPI.
- Music has a portrait player. Shelf keeps its accepted landscape layout and adapts controls on side docks. Chat/Agents/status cards reserve space for the smaller avatar. Narrow upload places the dog above text and uses a full-width progress track.
- Existing island pages share short directional transitions; side navigation moves vertically. Settings share the same 180ms entrance timing. Reduced-motion preference removes travel. Greeting retains its responsive short illustration.
- Alt-drag on Shelf does not start native file drag simultaneously.

## Automated evidence

- 349 frontend tests across 57 files passed.
- Eight native window-geometry tests passed, including side orientation, screen boundaries and high-DPI work-area limits.
- TypeScript/Vite production build, cargo check and git diff whitespace check passed.
- Native Shelf file-drag path validation and canonical-path icon tests passed earlier in this session. Failed icon retries have a frontend regression.

## Interactive checks still required

1. Drag the grip along each edge, travel around corners, release quickly and slowly. The capsule should stay attached and the saved position should match the visible release point.
2. Start another move and press Esc, especially near a corner. The previous edge and saved position should return. Repeat a drag after cancellation.
3. Open Music, Agents, Chat, Files/Clipboard and upload/choose/status views on both side docks. Check header actions, long Thai/English titles, volume controls and horizontal Shelf scrolling. Resize the portrait panel and return to the top edge; landscape dimensions should be unchanged.
4. Use Alt-drag over a Shelf file: only the island should move. A normal file drag should copy selected files to an Explorer folder; original Shelf files should remain.
5. Enable Windows reduced motion and rapidly switch tabs. No overlapping interactive pages, delayed blank view or stuck drag state should remain.

These visual/interactive checks were not automated through the desktop and are not claimed as passed.
