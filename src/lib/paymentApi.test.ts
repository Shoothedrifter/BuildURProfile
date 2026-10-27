import { afterEach, describe, expect, it, vi } from "vitest";
import { submitAlipayForm } from "./paymentApi";

afterEach(() => {
  document.querySelectorAll("form[data-test-payment]").forEach((form) => form.remove());
  vi.restoreAllMocks();
});

describe("Alipay form handoff", () => {
  it("submits only a POST to the configured sandbox gateway", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    submitAlipayForm('<form data-test-payment method="post" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do"><input name="biz_content" value="{}"></form>', "sandbox");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("rejects production gateway or GET forms during a sandbox run", () => {
    expect(() => submitAlipayForm('<form method="post" action="https://openapi.alipay.com/gateway.do"></form>', "sandbox"))
      .toThrow(/地址无效/);
    expect(() => submitAlipayForm('<form method="get" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do"></form>', "sandbox"))
      .toThrow(/地址无效/);
  });
});
