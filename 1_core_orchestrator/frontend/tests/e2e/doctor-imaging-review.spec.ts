import { expect, test } from "@playwright/test";

type DoctorResultPayload = {
  doctor_result?: {
    findings?: Array<{ id?: string; name?: string }>;
    image_path?: string;
    summary?: { total_findings?: number };
    densenet_probs?: Record<string, number>;
    rejected?: Array<{
      disease?: string;
      reason?: string;
      confidence?: number;
    }>;
  };
};

test("doctor imaging review renders structured data and saves doctor_result payload", async ({ page }) => {
  let savedPayload: DoctorResultPayload | null = null;

  await page.route("**/api/threads/thread-e2e/imaging-reports/report-e2e", async (route) => {
    savedPayload = JSON.parse(route.request().postData() ?? "{}") as DoctorResultPayload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/mock/doctor-imaging-review");

  await expect(page.getByRole("heading", { name: "Doctor Imaging Review Test Harness" })).toBeVisible();
  await expect(page.getByText("DenseNet 疾病概率")).toBeVisible();
  await expect(page.getByText("Pneumonia")).toBeVisible();
  await expect(page.getByText("过滤候选")).toBeVisible();
  await expect(page.getByText("Outside lung field")).toBeVisible();

  await page.getByRole("button", { name: "已保存" }).click();

  await expect.poll(() => savedPayload).not.toBeNull();

  expect(savedPayload).toMatchObject({
    doctor_result: {
      image_path: "/mock/chest-xray-demo.svg",
      summary: {
        total_findings: 1,
      },
      densenet_probs: {
        Pneumonia: 0.91,
      },
      rejected: [
        {
          disease: "结节",
          reason: "Outside lung field",
          confidence: 0.25,
        },
      ],
    },
  });

  const payload = (savedPayload ?? {}) as DoctorResultPayload;
  const doctorResult = payload.doctor_result;
  expect(doctorResult?.findings?.[0]?.id).toBe("finding-1");
  expect(doctorResult?.findings?.[0]?.name).toBe("肺炎");
});