---
name: Browser sound consent
description: Why saved auction sound preferences require activation again after a page reload
---

A saved opt-in expresses the player's preference, not browser permission to start audio. After reload, offer explicit activation and a separate way to mute the saved preference; do not construct or resume audio from room polling.

**Why:** Browsers can block audio until a new user gesture, even when a prior visit enabled sound. Treating persistence as permission risks either unwanted playback or a setting that claims to work while remaining silent.

**How to apply:** Keep sound consent separate from the current page's audio readiness for future room alerts. Tab-title alerts remain independent of audio readiness. Enabling may play a clearly described preview; do not replay an already observed event when sound becomes ready.