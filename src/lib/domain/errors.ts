export const ERROR_CODES = [
  "MODEL_NOT_AVAILABLE",
  "PROVIDER_NOT_AVAILABLE",
  "GPU_OUT_OF_MEMORY",
  "FRAME_NOT_FOUND",
  "INVALID_FRAME_RANGE",
  "PERMISSION_DENIED",
  "JOB_FAILED",
  "JOB_CANCELLED",
  "FFMPEG_FAILED",
  "STORAGE_ERROR",
  "MCP_TOOL_ERROR",
  "NOT_IMPLEMENTED",
  "UNAUTHORIZED",
  "PROJECT_NOT_FOUND",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "INVALID_KEYFRAME_PAIR",
  "KEYFRAME_NOT_FOUND",
  "FRAME_ASSET_UNAVAILABLE",
  "UNSUPPORTED_CONSTRAINT",
  "GENERATION_FAILED",
  "EVALUATION_FAILED",
  "INVALID_MOTION_PLAN",
  "CANDIDATE_NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class FrameLabError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FrameLabError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      ok: false as const,
      code: this.code,
      error: this.message,
    };
  }
}

export function fail(
  code: ErrorCode,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
): never {
  throw new FrameLabError(code, message, status, details);
}
