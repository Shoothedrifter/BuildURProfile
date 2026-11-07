import { AlipaySdk } from "alipay-sdk";
import { fenToYuan } from "./config.mjs";

export function createAlipayGateway(config) {
  const sdk = new AlipaySdk({
    appId: config.appId, privateKey: config.privateKey, alipayPublicKey: config.alipayPublicKey,
    gateway: config.gateway, keyType: config.privateKeyType ?? "PKCS8", camelcase: false
  });
  return {
    verifyNotify(params) { return sdk.checkNotifySignV2(params); },
    pagePay(order) {
      const options = {
        returnUrl: `${config.publicBaseUrl}/payment/return?project_id=${encodeURIComponent(order.project_id)}`,
        bizContent: {
          out_trade_no: order.out_trade_no, total_amount: fenToYuan(order.amount_fen),
          subject: "BuildURProfile 作品发布与导出服务", product_code: "FAST_INSTANT_TRADE_PAY"
        }
      };
      if (config.notifyUrl) options.notifyUrl = config.notifyUrl;
      return sdk.pageExec("alipay.trade.page.pay", "POST", options);
    },
    query(outTradeNo) {
      // validateSign verifies Alipay's signed query response; request success alone cannot grant access.
      return sdk.exec("alipay.trade.query", { bizContent: { out_trade_no: outTradeNo } }, { validateSign: true });
    }
  };
}
