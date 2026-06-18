<<<<<<< HEAD
# test
=======
# LLM SDK Chat Lab

一个本地聊天测试页，用于通过你提供的配置调用自研 `ai-gateway-sdk`，支持：

- 用户自填 `API Key`、`provider`、`model`、`base_url`、`protocol`
- 流式与非流式对话
- `temperature`、`top_p`、`max_tokens`、`timeout`、`max_retries`
- `extra_headers`、`extra_body`、`provider_options` 的 JSON 透传
- `AIProviderError` 统一错误展示

## 运行方式

项目不依赖第三方 Web 框架，直接使用 `test1` 环境中的 Python 标准库启动：

```powershell
conda run -n test1 python app.py --host 127.0.0.1 --port 8000
```

或使用便捷脚本：

```powershell
.\start_test1.ps1
```

启动后打开：

```text
http://127.0.0.1:8000
```

## 说明

- 后端只负责接收页面配置，并通过 `AIGatewayClient` 调用模型。
- 页面默认把常规配置保存在浏览器本地；`API Key` 只有勾选“将 API Key 一并保存到当前浏览器”时才会保存。
- 如果你不填 `api_key` 或 `base_url`，SDK 仍可按其自身规则回退读取环境变量。
>>>>>>> ce57e98 (init commit)
