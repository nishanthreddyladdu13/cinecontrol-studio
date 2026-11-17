
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeVideo,
} from 'mediabunny';

// Check whether this browser can create H.264 MP4.
export async function browserMp4Available(
  width = 480,
  height = 854,
  fps = 24
): Promise<boolean> {
  try {
    return await canEncodeVideo('avc', {
      width,
      height,
      frameRate: fps,
      quality: new Quality('high'),
    });
  } catch {
    return false;
  }
}

// Convert rendered PNG frames into an MP4 locally.
export async function encodePngFramesInBrowser(
  frames: Uint8Array[],
  fps: number
): Promise<Uint8Array> {
  if (!frames.length) {
    throw new Error('No video frames to encode.');
  }

  const firstFrame = await createImageBitmap(
    new Blob([new Uint8Array(frames[0])], {
      type: 'image/png',
    })
  );

  const { width, height } = firstFrame;

  if (!(await browserMp4Available(width, height, fps))) {
    firstFrame.close();
    throw new Error('Browser H.264 encoding is unavailable.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', {
    alpha: false,
  });

  if (!context) {
    firstFrame.close();
    throw new Error('Unable to create video canvas.');
  }

  const target = new BufferTarget();

  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  });

  const source = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new Quality('high'),
  });

  output.addVideoTrack(source);

  await output.start();

  for (let i = 0; i < frames.length; i++) {
    const bitmap =
      i === 0
        ? firstFrame
        : await createImageBitmap(
            new Blob([new Uint8Array(frames[i])], {
              type: 'image/png',
            })
          );

    try {
      if (bitmap.width !== width || bitmap.height !== height) {
        throw new Error('Video frames have different dimensions.');
      }

      context.drawImage(bitmap, 0, 0, width, height);

      await source.add(i / fps, 1 / fps);
    } finally {
      bitmap.close();
    }
  }

  await output.finalize();

  if (!target.buffer) {
    throw new Error('MP4 encoding produced no output.');
  }

  return new Uint8Array(target.buffer);
}

