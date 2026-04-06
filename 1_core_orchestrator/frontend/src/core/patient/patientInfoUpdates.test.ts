import { describe, expect, it } from "vitest";

import {
  buildPatientFieldChanges,
  buildPatientUpdateMessage,
  computeDirtyFields,
} from "./patientInfoUpdates";

describe("buildPatientFieldChanges", () => {
  it("derives added, updated, and deleted actions from saved and dirty fields", () => {
    expect(
      buildPatientFieldChanges(
        {
          chief_complaint: "胸痛",
          allergies: "青霉素过敏",
        },
        {
          chief_complaint: "胸痛 2 天",
          present_illness: "近 2 天加重",
          allergies: null,
        },
      ),
    ).toEqual([
      { field: "chief_complaint", action: "updated" },
      { field: "present_illness", action: "added" },
      { field: "allergies", action: "deleted" },
    ]);
  });
});

describe("computeDirtyFields", () => {
  it("returns only changed fields", () => {
    expect(
      computeDirtyFields(
        { name: "张三", age: 45, chief_complaint: "胸痛" },
        { name: "张三", age: 46, chief_complaint: "胸痛" },
      ),
    ).toEqual({ age: 46 });
  });

  it("treats blank strings and null as equivalent", () => {
    expect(
      computeDirtyFields(
        { present_illness: null },
        { present_illness: "   " },
      ),
    ).toEqual({});
  });
});

describe("buildPatientUpdateMessage", () => {
  it("creates a readable summary and omits blank values", () => {
    expect(
      buildPatientUpdateMessage(
        {
          age: 46,
          chief_complaint: "胸痛加重",
          present_illness: "   ",
        },
        {
          age: "年龄",
          chief_complaint: "主诉",
          present_illness: "现病史",
        },
      ),
    ).toBe("我刚在病历表单上更新了：年龄: 46、主诉: 胸痛加重");
  });
});