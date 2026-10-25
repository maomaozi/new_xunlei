from typing import Literal

ErrorCode = Literal[
    "not_found",
    "http_error",
    "invalid_request",
    "internal_error",
    "auth_required",
    "auth_failed",
    "xunlei_error",
    "xunlei_unreachable",
    "transfer_not_found",
    "invalid_transfer_state",
    "transfer_failed",
    "path_not_allowed",
    "path_not_found",
    "login_session_not_found",
    "engine_unavailable",
    "engine_error",
    "engine_binary_missing",
    "engine_busy",
    "engine_creation_ambiguous",
    "engine_instance_changed",
]

ERROR_MESSAGES: dict[ErrorCode, str] = {
    "not_found": "请求的资源不存在，请检查地址。",
    "http_error": "请求无法完成，请检查请求后重试。",
    "invalid_request": "请求参数不正确，请检查后重试。",
    "internal_error": "服务暂时无法处理请求，请稍后重试。",
    "auth_required": "尚未登录迅雷账号，请先在设置中登录或导入凭据。",
    "auth_failed": "迅雷账号认证失败，请重新登录。",
    "xunlei_error": "迅雷服务返回错误。",
    "xunlei_unreachable": "无法连接迅雷服务器，请检查网络或网络设置后重试。",
    "transfer_not_found": "传输任务不存在或已被删除。",
    "invalid_transfer_state": "当前任务状态不支持该操作。",
    "transfer_failed": "部分文件传输失败。",
    "path_not_allowed": "该路径不在允许访问的本机目录范围内。",
    "path_not_found": "本机路径不存在。",
    "login_session_not_found": "扫码会话已失效，请重新获取二维码。",
    "engine_unavailable": "下载引擎未运行，请在「下载引擎」页面启动后重试。",
    "engine_error": "下载引擎返回错误。",
    "engine_binary_missing": "未找到迅雷下载引擎程序（xunlei-pan-cli），请在设置中指定路径。",
    "engine_creation_ambiguous": "提交结果尚未确认，请先检查任务列表。",
    "engine_instance_changed": "下载引擎实例已更改，请刷新后重试。",
    "engine_busy": "下载引擎正在运行，请先停止后再执行该操作。",
}


class AppError(Exception):
    """Business error converted into the structured error response."""

    def __init__(self, code: ErrorCode, status: int = 400, message: str | None = None) -> None:
        super().__init__(code)
        self.code: ErrorCode = code
        self.status = status
        self.message = message or ERROR_MESSAGES[code]
