import asyncio
import base64
import io
import logging
import os
import re
import sys
import time
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from PIL import Image

logger = logging.getLogger("image2")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if not getattr(sys, 'frozen', False):
    load_dotenv(_BACKEND_ROOT / ".env", override=True)

DEFAULT_IMAGE_API_BASE_URL = "https://proaiapi.tech/v1"


def normalize_image_api_base_url(base_url: str | None) -> str:
    base = (base_url or DEFAULT_IMAGE_API_BASE_URL).strip().rstrip("/")
    return re.sub(r"(?i)(/v1)+$", "/v1", base)


IMAGE_API_BASE_URL = normalize_image_api_base_url(os.getenv("IMAGE_API_BASE_URL"))
IMAGE_API_KEY = os.getenv("IMAGE_API_KEY", "")
IMAGE_MODEL = "gpt-image-2"

logger.info("Image2 base URL: %s", IMAGE_API_BASE_URL)
IMAGE_SIZE = "1024x1536"

if getattr(sys, 'frozen', False):
    OUTPUT_DIR = Path(sys.executable).resolve().parent / "manga_outputs"
else:
    OUTPUT_DIR = _BACKEND_ROOT / "manga_outputs"

MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds


def _image_auth_headers(api_key: str | None = None, json_content: bool = False) -> dict[str, str]:
    key = (api_key or IMAGE_API_KEY or "").strip()
    if not key:
        from .errors import MissingApiKeyError
        raise MissingApiKeyError("Image2")
    headers = {"Authorization": f"Bearer {key}"}
    if json_content:
        headers["Content-Type"] = "application/json"
    return headers


async def generate_manga_image(
    scene_prompt: str,
    chapter_id: int,
    image_number: int,
    all_scenes: list[str] | None = None,
    character_profiles: str = "",
    ref_image_paths: list[str] | None = None,
    color_mode: str = "bw",
    api_key: str | None = None,
) -> str:
    """Generate a single manga image and save it. Returns the relative file path."""

    total_pages = len(all_scenes) if all_scenes else 1
    progress_label = f"{image_number}/{total_pages}"
    valid_refs = [Path(p) for p in (ref_image_paths or []) if p and Path(p).exists()]
    use_ref = bool(valid_refs)

    char_block = ""
    if character_profiles and not use_ref:
        char_block = (
            "【角色外貌设定（每张图必须严格遵守）】\n"
            f"{character_profiles}\n\n"
        )

    ref_block = ""
    if use_ref:
        ref_block = (
            "【最重要：人物一致性】\n"
            "本次提供了参考图，**必须严格保持参考图中主角的外貌特征**："
            "包括发型、发色、瞳色、脸型、五官比例、服装风格——所有分镜格中的人物都必须是参考图中的同一批人物。\n"
            "禁止凭空创造新的人物外貌。\n\n"
        )

    if color_mode == "color":
        MANGA_STYLE = (
            "日式彩色漫画插画页，竖向多格分镜布局，每页包含4-6个分镜格，"
            "格子高度不等（动作场景用宽格，对话特写用窄格），"
            "每个分镜格之间有清晰的边框分隔，"
            "包含圆形/椭圆形对话气泡和中文台词，"
            "包含漫画音效字（如“唷”“铿！”“嗡—”），"
            "全彩高饱和度配色，日系动漫赛璐珞上色风格，"
            "柔和光影与高光，细腻的色彩渐变，"
            "人物绘制精美，表情生动，动作有力度感"
        )
    elif color_mode == "bw" or not color_mode:
        MANGA_STYLE = (
            "日式黑白漫画页，竖向多格分镜布局，每页包含4-6个分镜格，"
            "格子高度不等（动作场景用宽格，对话特写用窄格），"
            "每个分镜格之间有清晰的黑色边框分隔，"
            "包含圆形/椭圆形白色对话气泡和中文台词，"
            "包含漫画音效字（如“唷”“铿！”“嗡—”），"
            "黑白高对比度，戏剧性光影，精细的线条和网点，"
            "人物绘制精美，表情生动，动作有力度感"
        )
    else:
        MANGA_STYLE = color_mode

    if all_scenes:
        script_context = "\n".join(f"第{i+1}页：{s}" for i, s in enumerate(all_scenes))
        full_prompt = (
            f"{ref_block}"
            f"{char_block}"
            f"你正在绘制一部日式漫画的第{image_number}页（共{total_pages}页）。\n"
            f"以下是完整的{total_pages}页的分镜脚本，请保持人物外貌、服装、风格的一致性：\n\n"
            f"{script_context}\n\n"
            f"【本页详细分镜（请严格按此绘制）】\n{scene_prompt}\n\n"
            f"【画风要求】{MANGA_STYLE}"
        )
    else:
        full_prompt = (
            f"{ref_block}"
            f"{char_block}"
            f"请绘制一页日式漫画，共{image_number}/{total_pages}页。\n"
            f"【分镜描述】\n{scene_prompt}\n\n"
            f"【画风要求】{MANGA_STYLE}"
        )

    chapter_dir = OUTPUT_DIR / f"chapter_{chapter_id}"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    image_id = uuid.uuid4().hex[:8]
    output_path = chapter_dir / f"panel_{image_number:02d}_{image_id}.png"
    rel_path = f"manga_outputs/chapter_{chapter_id}/panel_{image_number:02d}_{image_id}.png"

    timeout = httpx.Timeout(600.0, connect=60.0)
    limits = httpx.Limits(max_keepalive_connections=2, max_connections=4)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout, limits=limits, trust_env=True) as client:
                parts = [
                    ("model", (None, IMAGE_MODEL)),
                    ("prompt", (None, full_prompt)),
                    ("n", (None, "1")),
                    ("size", (None, IMAGE_SIZE)),
                    ("response_format", (None, "b64_json")),
                ]
                for idx, ref_path in enumerate(valid_refs):
                    mime_type = "image/png" if ref_path.suffix.lower() == ".png" else "image/jpeg"
                    parts.append(
                        (
                            f"image[{idx}]",
                            (ref_path.name, ref_path.read_bytes(), mime_type),
                        )
                    )
                resp = await client.post(
                    f"{IMAGE_API_BASE_URL}/images/generations",
                    files=parts,
                    headers=_image_auth_headers(api_key),
                )
                resp_data = resp.json()
                if not resp.is_success:
                    err_msg = resp_data.get("error", {}).get("message", "") or resp.text
                    logger.warning(
                        "Image attempt %d/%d failed (HTTP %s): %s",
                        attempt, MAX_RETRIES, resp.status_code, err_msg[:200]
                    )
                    if resp.status_code == 401 or resp.status_code == 403:
                        raise RuntimeError(f"Image2 API Key invalid or unauthorized: {err_msg}")
                    if resp.status_code == 429:
                        raise RuntimeError("Image2 API rate limited. Please wait and try again.")
                    if attempt < MAX_RETRIES:
                        await asyncio.sleep(RETRY_DELAY * attempt)
                        continue
                    raise RuntimeError(f"Image generation failed after {MAX_RETRIES} attempts: {err_msg}")

                b64 = resp_data["data"][0].get("b64_json", "")
                if b64:
                    try:
                        img_bytes = base64.b64decode(b64)
                        with Image.open(io.BytesIO(img_bytes)) as img:
                            img.convert("RGB").save(output_path, "PNG", optimize=True)
                        logger.info(
                            "Generated panel %s/%s -> %s [attempt %d]",
                            image_number, total_pages, rel_path, attempt,
                        )
                        return rel_path
                    except Exception as decode_err:
                        logger.warning(
                            "Failed to decode/save generated image (attempt %d): %s", attempt, decode_err
                        )
                        if attempt < MAX_RETRIES:
                            await asyncio.sleep(RETRY_DELAY * attempt)
                            continue
                        raise RuntimeError(f"Failed to process generated image: {decode_err}")
                else:
                    url = resp_data["data"][0].get("url", "")
                    if not url:
                        raise RuntimeError("Image API returned no image data")
                    async with httpx.AsyncClient(timeout=300, trust_env=True) as dl_client:
                        dl_resp = await dl_client.get(url)
                        dl_resp.raise_for_status()
                        img_bytes = dl_resp.content
                        with Image.open(io.BytesIO(img_bytes)) as img:
                            img.convert("RGB").save(output_path, "PNG", optimize=True)
                        logger.info(
                            "Generated panel %s/%s -> %s [attempt %d, URL]",
                            image_number, total_pages, rel_path, attempt,
                        )
                        return rel_path
        except RuntimeError:
            raise
        except Exception as e:
            logger.warning("Image attempt %d/%d failed: %s", attempt, MAX_RETRIES, e)
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY * attempt)
                continue
            raise RuntimeError(f"Image generation failed after {MAX_RETRIES} attempts: {e}")

    raise RuntimeError(f"Image generation failed after {MAX_RETRIES} attempts")
