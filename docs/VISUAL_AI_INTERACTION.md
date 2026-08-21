# Visual AI Interaction

Show me, don’t only tell me.

User: “這裡為什麼怪怪的？”

FrameLab:

1. Reads the selected region and neighbors
2. Runs lightweight / assist analysis
3. Returns `VisualAnnotation` (region + pointer + range)
4. UI: seek the peak frame, highlight F105–107, zoom the hand, draw the motion trail

The AI panel is an overlay. Compact state is a corner orb (idle / looking / analyzing / problem). It never permanently steals 30–40% of the canvas.

Conversation chips show what the model is looking at: `F105` · `F103–F108` · character · region · overlay.

Suggested actions (`View`, `Compare`, `Create repair`) drive the same workspace — they do not dump JSON.

MCP returns annotations. Frontend renders. No CSS selectors, no DOM commands.
