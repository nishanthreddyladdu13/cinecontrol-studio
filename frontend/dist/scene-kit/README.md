# CineControl ChatGPT scene generator kit

1. Upload the master prompt, scene schema, capability manifest, and asset manifest together to ChatGPT. Use the master prompt as project instructions or paste it into the conversation.
2. Describe the new scene in your own words. Give approximate location, important objects, blocking, action, and camera requirements.
3. Ask for the scene JSON. In CineControl, open **Script**, then paste it in **Scene JSON** and select **Build scene from JSON**. You can also open a downloaded `.json` file.
4. Open **Scene import report** in Script or Stages and assets to review approximations. Edit the objects, tracks, keyframes, and cameras before exporting.
5. Export the kit again after a new CineControl version. The application constructs these scenes locally using the included models. The regular Script generation button still uses the optional configured API.

The example folder covers an observatory with two stages, courtyard navigation, a basketball pass, a forest crossing, a sluice with a physics-driven bounce, and a street sequence.
