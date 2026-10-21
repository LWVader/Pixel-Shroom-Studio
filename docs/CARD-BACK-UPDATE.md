# Supplied spinning card back

The supplied Sir Shroomalot portrait is now `public/assets/foil-card-back.jpg`. Its original JPEG bytes and 1280 × 1909 proportions are preserved. Both the rotating back and the opaque front seal use this design, without the previous text/diamond covering it. The front tier artwork remains hidden until the reveal ends.

The animation waits for the back image and tier artwork to decode. Reduced motion, Skip, Replay, lighting effects, and the paid-only reveal flow remain supported. Source tier files, copy hashes, payment logic, and ownership are unchanged.

Replace the included files in your testing branch and restart `npm.cmd run demo` for local review. For the hosted storefront, deploy through the existing testing workflow so the updated HTML, CSS, JavaScript and JPEG asset are deployed together. Cache versions were updated for the checkout entry point and reveal module. No database migration or Modal update is required.
