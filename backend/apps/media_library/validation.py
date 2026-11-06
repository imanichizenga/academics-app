"""File type detection from magic bytes. The extension and browser-sent MIME are never trusted."""
import magic
from pathlib import PurePosixPath

EXT_KIND = {
    ".pdf": "pdf", ".docx": "docx", ".pptx": "pptx", ".xlsx": "xlsx", ".epub": "epub", ".txt": "txt",
    ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image", ".avif": "image",
    ".mp3": "audio", ".m4a": "audio", ".wav": "audio",
    ".mp4": "video", ".mov": "video", ".mkv": "video", ".webm": "video",
}
ZIP_MIMES = {"application/zip", "application/x-zip-compressed", "application/octet-stream"}
KIND_MIMES = {
    "pdf": {"application/pdf"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"} | ZIP_MIMES,
    "pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"} | ZIP_MIMES,
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} | ZIP_MIMES,
    "epub": {"application/epub+zip"} | ZIP_MIMES,
    "txt": {"text/plain", "text/csv"},
    "image": {"image/jpeg", "image/png", "image/webp", "image/avif"},
    "audio": {"audio/mpeg", "audio/mp3", "audio/x-m4a", "audio/mp4", "audio/wav", "audio/x-wav", "video/mp4"},
    "video": {"video/mp4", "video/quicktime", "video/x-matroska", "video/webm", "application/x-matroska"},
}
FORBIDDEN_PREFIXES = (b"MZ", b"\x7fELF", b"#!", b"\xca\xfe\xba\xbe", b"\xcf\xfa\xed\xfe")


class Rejected(ValueError):
    pass


def kind_from_name(filename):
    return EXT_KIND.get(PurePosixPath(filename.lower()).suffix)


def sniff(head):
    return magic.from_buffer(head, mime=True)


def verify(filename, head):
    """Return (kind, mime) or raise Rejected. head is the first 8 KB or more of the file."""
    kind = kind_from_name(filename)
    if kind is None:
        raise Rejected("This file type is not allowed.")
    if head.startswith(FORBIDDEN_PREFIXES):
        raise Rejected("Executable files and scripts are not allowed.")
    mime = sniff(head)
    if mime not in KIND_MIMES[kind]:
        raise Rejected(f"This file's contents ({mime}) do not match its .{filename.rsplit('.', 1)[-1]} extension.")
    if mime in ZIP_MIMES and not head.startswith(b"PK\x03\x04"):
        raise Rejected("This file's contents do not match its extension.")
    return kind, mime
