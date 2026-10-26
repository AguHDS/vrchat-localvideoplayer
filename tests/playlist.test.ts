import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import {
  buildFfmpegArgs,
  buildPlaylistFilterGraph,
  choosePlaylistTarget,
  ffmpegInstallInstructions,
  parseFfprobeOutput,
} from '../src/video/playlist';
import type { ValidatedVideo } from '../src/video/validate';

const probed = {
  durationSeconds: 10,
  video: {
    index: 0,
    codecType: 'video',
    codecName: 'h264',
    width: 1920,
    height: 1080,
    durationSeconds: 10,
  },
  audio: {
    index: 1,
    codecType: 'audio',
    codecName: 'aac',
    width: null,
    height: null,
    durationSeconds: 10,
  },
};

function video(filePath: string): ValidatedVideo {
  return {
    filePath,
    fileName: 'video.mp4',
    extension: '.mp4',
    mimeType: 'video/mp4',
    size: 100,
    mtimeMs: 0,
    fastStart: true,
  };
}

describe('playlist helpers', () => {
  it('parses ffprobe output', () => {
    const info = parseFfprobeOutput(
      JSON.stringify({
        format: { duration: '12.5' },
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
          { index: 1, codec_type: 'audio', codec_name: 'aac' },
        ],
      }),
    );
    expect(info.durationSeconds).toBe(12.5);
    expect(info.video.codecName).toBe('h264');
    expect(info.audio?.codecName).toBe('aac');
  });

  it('rejects media without a video stream', () => {
    expect(() =>
      parseFfprobeOutput(
        JSON.stringify({ format: { duration: '1' }, streams: [{ codec_type: 'audio' }] }),
      ),
    ).toThrow(AppError);
  });

  it('chooses even target dimensions within 1920x1080', () => {
    const target = choosePlaylistTarget([
      { ...probed, video: { ...probed.video, width: 1080, height: 1920 } },
    ]);
    expect(target.width % 2).toBe(0);
    expect(target.height % 2).toBe(0);
    expect(target.width).toBeLessThanOrEqual(1920);
    expect(target.height).toBeLessThanOrEqual(1080);
    expect(target.fps).toBe(30);
  });

  it('builds silence for videos without audio', () => {
    const graph = buildPlaylistFilterGraph(
      [{ ...probed, audio: null }, probed],
      { width: 1920, height: 1080, fps: 30 },
    );
    expect(graph).toContain('anullsrc');
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(graph).toContain('aformat=sample_fmts=fltp:sample_rates=48000');
  });

  it('builds safe ffmpeg arguments', () => {
    const input = video("C:\\ user's video.mp4");
    const args = buildFfmpegArgs([input], 'graph', 'C:\\output playlist.mp4');
    expect(args).toContain(input.filePath);
    expect(args).toContain('+faststart');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).not.toContain('concat');
  });

  it('provides Windows installation commands', () => {
    const instructions = ffmpegInstallInstructions('win32', false);
    expect(instructions).toContain('winget install --id Gyan.FFmpeg');
    expect(instructions).toContain('ffprobe -version');
  });

  it('provides WSL2 installation commands', () => {
    const instructions = ffmpegInstallInstructions('linux', true);
    expect(instructions).toContain('sudo apt install -y ffmpeg');
    expect(instructions).toContain('WSL2');
  });

  it('provides native Linux package manager commands', () => {
    const instructions = ffmpegInstallInstructions('linux', false);
    expect(instructions).toContain('sudo dnf install -y ffmpeg');
    expect(instructions).toContain('sudo pacman -S ffmpeg');
  });
});
