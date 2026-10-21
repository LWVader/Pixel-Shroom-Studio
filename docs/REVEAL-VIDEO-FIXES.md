# Reveal fixes from the supplied recording

Replace the included files in the same paths on the testing branch, stop the running demo and restart `npm.cmd run demo`. For a hosted test, deploy the updated checkout HTML, reveal JavaScript and CSS together; their cache versions have changed.

- The stage now follows the actual artwork proportions. Square tier art fills a square stage rather than appearing inside a tall black carrier. The portrait Sir Shroomalot back stays complete using contain sizing.
- The opening lasts about 3.2 seconds with multiple turns, charge, lightning, sparks and a settle phase. Both faces remain sealed for the full spin; only then does the artwork fade in.
- Replay resets the heading and hides purchase actions while opening. It cannot change the assigned tier, copy or hash.
- Replay and Skip are compact gold controls using the existing site palette. Skip stays disabled when idle so the control positions remain stable. The purchase actions wrap cleanly below the controls.
- The demo stage is larger for square images while remaining responsive. Reduced motion and Skip still provide immediate completion.

No database migration, worker deployment or payment configuration change is required. The uploaded tier images and card-back source file are unchanged.
