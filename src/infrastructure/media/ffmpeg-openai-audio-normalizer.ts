import { execFile } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { OpenAIAudioNormalizer } from "../../application/ports/audio-normalizer.js";

const execFileAsync = promisify(execFile);
const OPENAI_DIRECT_AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/webm"]);
let lambdaExecutable: Promise<string> | undefined;

export class FfmpegOpenAIAudioNormalizer implements OpenAIAudioNormalizer {
  public async normalize(input: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ bytes: Uint8Array; extension: string; mimeType: string }> {
    if (OPENAI_DIRECT_AUDIO_TYPES.has(input.mimeType)) {
      return {
        bytes: input.bytes,
        extension:
          input.mimeType === "audio/mpeg" ? "mp3" : input.mimeType === "audio/mp4" ? "m4a" : "webm",
        mimeType: input.mimeType,
      };
    }

    const directory = await mkdtemp(join(tmpdir(), "tinkiva-openai-audio-"));
    const source = join(directory, "source.audio");
    const output = join(directory, "normalized.mp3");
    try {
      await writeFile(source, input.bytes);
      await execFileAsync(
        await ffmpegExecutable(),
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          source,
          "-vn",
          "-f",
          "mp3",
          output,
        ],
        { timeout: 20_000, windowsHide: true },
      );
      return {
        bytes: new Uint8Array(await readFile(output)),
        extension: "mp3",
        mimeType: "audio/mpeg",
      };
    } catch (error) {
      throw new RangeError("The inbound audio could not be normalized for OpenAI.", {
        cause: error,
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

const ffmpegExecutable = (): Promise<string> => {
  if (process.platform !== "linux" || process.arch !== "arm64") {
    return Promise.resolve(process.env.FFMPEG_PATH ?? "ffmpeg");
  }
  lambdaExecutable ??= prepareLambdaExecutable();
  return lambdaExecutable;
};

const prepareLambdaExecutable = async (): Promise<string> => {
  const source = join(process.cwd(), "node_modules", "@ffmpeg-installer", "linux-arm64", "ffmpeg");
  const target = join(tmpdir(), "tinkiva-messaging-ffmpeg");
  await copyFile(source, target);
  await chmod(target, 0o755);
  return target;
};
