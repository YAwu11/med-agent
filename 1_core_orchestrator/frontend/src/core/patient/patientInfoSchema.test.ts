import { describe, expect, it } from "vitest";

import { PATIENT_INFO_FIELDS } from "./patientInfoSchema";

describe("PATIENT_INFO_FIELDS", () => {
  it("uses canonical medical history keys", () => {
    const keys = PATIENT_INFO_FIELDS.map((field) => field.key);

    expect(keys).toContain("medical_history");
    expect(keys).toContain("allergies");
    expect(keys).not.toContain("past_history");
    expect(keys).not.toContain("allergy_history");
  });
});