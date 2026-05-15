# Marketing portraits

The marketing page's Mission, For Caregivers, and For Operators sections render documentary-style human imagery from this directory. Until real files are dropped here, each `<PortraitFrame>` falls back to a warm-orange gradient placeholder with a `User` silhouette + caption — the page still looks intentional, but the emotional pull lands much harder once real portraits exist.

## Files referenced by the page

| Path | Aspect | Used in | What it shows |
|---|---|---|---|
| `mission-hero.jpg` | 16:9 cinematic | Mission section, above the manifesto | A caregiver's hands meeting an elderly person's hands — the quiet centre of what residential care is |
| `caregiver.jpg` | 1:1 square | For Caregivers QuoteCard | A caregiver in a residential home, late afternoon light, looking quietly forward |
| `operator.jpg` | 1:1 square | For Operators QuoteCard | A residential care facility operator at her kitchen island, holding a tablet, warm capable expression |

Recommended export: JPG at 2× target display size (so `mission-hero.jpg` ≈ 2048×1152, the two square portraits ≈ 720×720). Optimize before commit (tinypng / squoosh).

---

## AI generation prompts

Designed for Midjourney v6 / DALL-E 3 / Flux / Stable Diffusion XL. Adjust the trailing parameters (`--ar`, `--style`, `--v`) to your tool's conventions. All three share a consistent style direction so the page reads as one campaign rather than three random stock images.

**Shared style direction (apply to every prompt):**
> Documentary photography, soft golden-hour natural light, residential interior softly out of focus, warm cream and terracotta tones, skin texture visible, no over-retouching, candid not posed, dignified. Style references: Annie Leibovitz, Pari Dukovic, Magnum Photos documentary work. Photographic — NOT illustrated, NOT 3D render, NOT stock photo.

### 1. `mission-hero.jpg` — the cinematic moment

> A close, intimate documentary photograph of two pairs of hands meeting — a younger caregiver's hand gently holding an older person's hand from above, fingers softly intertwined. Hands occupy the lower third of the frame; the upper portion is soft-focus warm light from a window. Skin texture and gentle wrinkles visible on the older hand. No jewelry, no rings, no medical equipment, no IV lines. Residential living room in the background (cream sofa, soft cushions, a sliver of a wood side table) entirely out of focus. Golden hour, warm cream and terracotta colour grading. Cinematic wide aspect. The mood: quiet, dignified, present. Photographic, not illustrated. --ar 16:9 --style raw --v 6

### 2. `caregiver.jpg` — the work itself

> A documentary square portrait of a caregiver in their late 20s to early 40s, mixed-race or Filipino-American or Black, looking slightly off-camera with quiet confident warmth. Wearing simple care attire — no scrubs, a soft cardigan or fitted cotton top in a warm neutral. Late afternoon natural light from a window to the left of frame. Residential home interior softly out of focus behind (cream wall, plant, framed picture). Skin texture visible, gentle smile, no teeth showing. Subject fills the upper two-thirds of the frame; tight crop just below shoulders. Warm cream and terracotta colour grading. Photographic, not illustrated, not stock. --ar 1:1 --style raw --v 6

### 3. `operator.jpg` — the person who runs the home

> A documentary square portrait of a residential care facility operator in her 40s-50s — Filipina, Latina, or Black woman — standing at the kitchen island of her residential care home, holding a tablet, looking at the camera with capable warmth. Reading glasses pushed up on her head or hanging from a lanyard. Soft cream walls behind her, a plant on the island, a framed CDSS licence visible at the edge of the frame (slightly out of focus). Late afternoon natural light from a window. Skin texture visible, slight knowing smile. Subject fills the upper two-thirds of the frame; tight crop just below shoulders. Warm cream and terracotta colour grading. Photographic, not illustrated, not stock. --ar 1:1 --style raw --v 6

---

## QA checklist before committing the images

- [ ] No identifiable real-person resemblance (AI generation can occasionally drift toward real public figures — re-roll if so).
- [ ] No watermarks, logos, brand-name signage, or readable text in frame.
- [ ] No medical scrubs, hospital settings, IV equipment, or stethoscopes — this is **residential** care, not clinical.
- [ ] No staged "happy" smiles — the brand voice is dignified, not stock-photo cheerful.
- [ ] Colour grade is in the warm cream / terracotta family — drop saturation / cool tones in post if needed.
- [ ] Skin texture is visible — if the AI over-smoothed, re-roll or apply subtle grain in post.
- [ ] File size under 250 KB after compression (run through squoosh.app at quality 75-80).

## When this directory has real images

Just drop the JPGs in at the filenames above and refresh the marketing page. The `PortraitFrame` `onError` handler swaps to the gradient fallback only when the image fails to load — once the files are present, the page picks them up automatically.
