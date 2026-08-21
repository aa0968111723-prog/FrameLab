import type { JobType } from "@/lib/domain/types";
import { FrameLabError, fail } from "@/lib/domain/errors";
import * as repo from "@/lib/framelab/repo";
import type { JobStageInfo } from "@/lib/domain/job-progress";

function isOom(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /out of memory|cuda.?oom|GPU_OUT_OF_MEMORY/i.test(msg);
}

export type JobProgress = (n: number, stage?: JobStageInfo) => Promise<void>;

export async function withJob<T>(opts: {
  userId: string;
  projectId?: string | null;
  type: JobType;
  payload?: unknown;
  provider?: string;
  model?: string;
  device?: string;
  work: (jobId: string, progress: JobProgress) => Promise<T>;
  summarize?: (result: T) => unknown;
}): Promise<{ jobId: string; jobState: "completed"; result: T }> {
  const job = await repo.insertJob({
    userId: opts.userId,
    projectId: opts.projectId,
    type: opts.type,
    payload: opts.payload,
  });
  await repo.updateJob(job.id, {
    state: "running",
    progress: 1,
    provider: opts.provider ?? "framelab",
    model_name: opts.model ?? "pixel-metrics",
    model_version: "0.1",
    device: opts.device ?? "cpu",
  });
  const progress: JobProgress = async (n, stage) => {
    const latest = await repo.getJob(opts.userId, job.id);
    if (latest?.state === "cancelled") {
      fail("JOB_CANCELLED", "Job cancelled by caller");
    }
    await repo.updateJob(job.id, {
      progress: Math.max(0, Math.min(100, Math.round(n))),
      result_json: stage
        ? JSON.stringify({ stage, current: stage.current, total: stage.total, label: stage.label })
        : latest?.result_json,
    });
  };
  const runWork = () => opts.work(job.id, progress);
  try {
    let result: T;
    try {
      result = await runWork();
    } catch (err) {
      if (!isOom(err)) throw err;
      // spec §61: retry once on GPU_OUT_OF_MEMORY, never loop
      await repo.updateJob(job.id, {
        error_message: "GPU_OUT_OF_MEMORY retry once",
      });
      result = await runWork();
    }
    const latest = await repo.getJob(opts.userId, job.id);
    if (latest?.state === "cancelled") {
      fail("JOB_CANCELLED", "Job cancelled by caller");
    }
    const summary = opts.summarize ? opts.summarize(result) : { ok: true };
    await repo.updateJob(job.id, {
      state: "completed",
      progress: 100,
      result_json: JSON.stringify(summary),
    });
    return { jobId: job.id, jobState: "completed", result };
  } catch (err) {
    if (err instanceof FrameLabError && err.code === "JOB_CANCELLED") {
      await repo.updateJob(job.id, {
        state: "cancelled",
        error_code: "JOB_CANCELLED",
        error_message: "cancelled by caller",
      });
      throw err;
    }
    const oom = isOom(err);
    const code = oom
      ? "GPU_OUT_OF_MEMORY"
      : err instanceof FrameLabError
        ? err.code
        : "JOB_FAILED";
    const message = err instanceof Error ? err.message : String(err);
    await repo.updateJob(job.id, {
      state: "failed",
      error_code: code,
      error_message: message.slice(0, 500),
    });
    throw err;
  }
}
