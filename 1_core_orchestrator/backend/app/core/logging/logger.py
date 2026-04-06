import logging
import sys
from pathlib import Path
from loguru import logger
from asgi_correlation_id import correlation_id

class InterceptHandler(logging.Handler):
    """
    将标准 logging 拦截并路由回 Loguru
    """
    def emit(self, record):
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = logging.currentframe(), 2
        while frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())

def setup_logging():
    # 移除可能存在的默认 handler
    logger.remove()

    # 确定日志存放目录
    log_dir = Path(__file__).parent.parent.parent.parent / "data" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    def format_log(record):
        # 尝试获取当前请求的 trace_id
        req_id = correlation_id.get()
        req_part = f"<yellow><b>[{req_id}]</b></yellow> | " if req_id else ""
        return (
            "<green>{time:MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
            + req_part +
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>\n"
            "{exception}"
        )

    # 1. 终端输出（彩色、美观）
    logger.add(
        sys.stderr,
        format=format_log,
        level="INFO",
        colorize=True,
    )

    # 2. 全量业务日志归档
    logger.add(
        log_dir / "gateway.log",
        format=format_log,
        level="INFO",
        rotation="50 MB",
        retention="7 days",
        encoding="utf-8",
        # 并发较少时保持 False 更安全且不丢末尾日志
        enqueue=False,
    )

    # 3. 错误日志提纯
    logger.add(
        log_dir / "error.log",
        format=format_log,
        level="ERROR",
        rotation="10 MB",
        retention="14 days",
        encoding="utf-8",
        enqueue=False,
    )

    # 接管各类原生日志系统
    logging.getLogger().handlers = [InterceptHandler()]
    logging.getLogger().setLevel(logging.INFO)

    for logger_name in ("uvicorn.access", "uvicorn.error", "uvicorn", "fastapi"):
        logging_logger = logging.getLogger(logger_name)
        logging_logger.handlers = [InterceptHandler()]
        # 防止 uvicorn.access 发出冗余双重输出
        logging_logger.propagate = False
