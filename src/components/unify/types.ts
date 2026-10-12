import type { BatchDto, FileDto, JobDto, LabelDto } from "@/lib/serializers";

export type { BatchDto, FileDto, JobDto, LabelDto };

export interface BatchDetail {
  batch: BatchDto;
  files: FileDto[];
  labels: LabelDto[];
  job: JobDto | null;
}

export interface UploadItem {
  key: string;
  file: File;
  progress: number;
  status: "queued" | "uploading" | "error";
  error?: string;
}
