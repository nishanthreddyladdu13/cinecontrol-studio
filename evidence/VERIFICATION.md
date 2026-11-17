# Verification

The browser loaded the complete street scene using software rendering. The low camera inspector showed 0.15 m. At timeline time 8.50 s the sedan reached [1.75, 0, 3]. Changing road width from 8.0 to 8.4 m survived saving and reloading. The video review panel displayed the 3D reference beside the clip input.

The downloaded ZIP was unzipped and checked. Each of the clay, depth, normal and pose passes contained five PNGs of 288 × 512 pixels. Camera and pose records shared five matching timestamps at 24 fps. Clay images changed in every consecutive frame. This confirms guidance export and motion sampling for the tested interval.

The scene-creation path was tested using simulated model outputs. Live Gemini and Windows execution require a configured user machine. Cinematic AI video is an external manual step.

The supplied legacy 0.1 street JSON migrated with six shots, 16 layout trees, moving vehicles, and the sedan's visibility change. FastAPI also encoded the captured clay frames to a valid MP4 and served both the new workspace and the original room editor.
