import { describe, expect, it } from "vitest";

import { parseThreadEventData } from "./thread-events";

describe("parseThreadEventData", () => {
  it("accepts upload_received events", () => {
    expect(
      parseThreadEventData(
        JSON.stringify({
          type: "upload_received",
          thread_id: "thread-1",
          event_id: "upload-123:received",
          upload_id: "upload-123",
          filename: "cbc.png",
          status: "processing",
        }),
      ),
    ).toEqual({
      type: "upload_received",
      thread_id: "thread-1",
      event_id: "upload-123:received",
      upload_id: "upload-123",
      filename: "cbc.png",
      status: "processing",
    });
  });

  it("accepts upload_analyzed events", () => {
    expect(
      parseThreadEventData(
        JSON.stringify({
          type: "upload_analyzed",
          thread_id: "thread-1",
          event_id: "upload-123:2026-04-05T12:00:00Z",
          upload_id: "upload-123",
          filename: "cbc.png",
          analysis_kind: "ocr",
          status: "completed",
          category: "lab_report",
          summary: "血红蛋白偏低",
        }),
      ),
    ).toEqual({
      type: "upload_analyzed",
      thread_id: "thread-1",
      event_id: "upload-123:2026-04-05T12:00:00Z",
      upload_id: "upload-123",
      filename: "cbc.png",
      analysis_kind: "ocr",
      status: "completed",
      category: "lab_report",
      summary: "血红蛋白偏低",
    });
  });

  it("ignores malformed payloads", () => {
    expect(parseThreadEventData("not-json")).toBeNull();
    expect(parseThreadEventData(JSON.stringify({ type: "upload_analyzed" }))).toBeNull();
  });
});