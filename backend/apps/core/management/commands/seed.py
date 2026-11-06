"""Demo data that exercises every content type. Refuses to run with DEBUG off unless --force is given."""
import io
import math
import random
import subprocess
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFont

from apps.accounts.models import User
from apps.catalog import services
from apps.catalog.models import Category, Content, Tag
from apps.core.models import SiteSettings
from apps.engagement.models import Bookmark, Comment, Reaction, ReadingProgress
from apps.media_library.models import MediaAsset
from apps.media_library.processing import process, webp
from apps.media_library.storage import get_storage
from apps.payments.models import Entitlement, Order, SubscriptionPlan

R = random.Random(7)
ADMIN_PHONE, EDITOR_PHONE = "255754000001", "255754000002"
DEMO_PASSWORD = "darasa-demo-2026"
FIRST = ["Asha", "Juma", "Neema", "Baraka", "Zawadi", "Hamisi", "Rehema", "Daudi", "Upendo", "Salim", "Halima", "Peter"]
LAST = ["Mushi", "Mwakyusa", "Massawe", "Kimaro", "Shayo", "Ally", "Mollel", "Nyerere", "Lema", "Mbwana", "Said"]
TREE = [
    ("Mathematics", "#4F46E5", "sigma", "Numbers, shapes and proofs, from basics to Form Six.",
     ["Algebra", "Geometry", "Statistics"]),
    ("Sciences", "#0D9488", "flask", "Physics, chemistry and biology explained with everyday examples.",
     ["Physics", "Chemistry", "Biology"]),
    ("Languages", "#DB2777", "languages", "Write clearly and speak with confidence.", ["English", "Kiswahili"]),
    ("Business", "#D97706", "briefcase", "Practical money skills for small business owners.",
     ["Bookkeeping", "Marketing"]),
    ("Technology", "#2563EB", "laptop", "Computers and code, starting from zero.", ["Programming", "Spreadsheets"]),
]
PARAS = {
    "Mathematics": [
        "Mathematics rewards patience. Every hard problem is a chain of small steps, and each step is something you can already do. The goal of this lesson is to make those steps visible.",
        "Start with a concrete example before reaching for a formula. If a shopkeeper in Kariakoo buys 12 crates at the same price and pays 96,000 shillings, you already know how to find the price of one crate. Algebra simply writes that reasoning down.",
        "When you get stuck, go back to the definition. Most mistakes come from using a rule outside the conditions where it holds, not from weak arithmetic.",
    ],
    "Sciences": [
        "Science starts with noticing. Why does a clay pot keep water cool? Why does charcoal glow without a flame? The ideas in this lesson explain things you have already seen at home.",
        "We will separate what we observe from how we explain it. Observations stay true even when explanations change, which is why good experiments are worth repeating.",
        "After each section, try to explain the idea to a friend without using the textbook words. If you can do that, you have understood it.",
    ],
    "Languages": [
        "Good writing is clear thinking made visible. Before you choose a word, decide what you want your reader to know, and then say that as simply as you can.",
        "Read the sentence aloud. If you run out of breath, it is too long. If it sounds like nobody you have ever met, it needs to be rewritten.",
        "Vocabulary grows through use. Choose five words from this lesson, write a sentence with each, and use one in conversation today.",
    ],
    "Business": [
        "Most small businesses do not fail for lack of customers. They fail because the owner cannot see where the money goes. A simple daily record fixes that.",
        "Separate the money of the business from your personal money, even if the business is a single stall. Pay yourself a fixed amount, and let the rest show you the truth.",
        "Look at your numbers every week. Ten minutes on a Sunday evening will tell you which products earn money and which only keep you busy.",
    ],
    "Technology": [
        "A computer does exactly what you tell it, nothing more. That can feel frustrating at first, and then it becomes the most reassuring thing about the work.",
        "Type the examples out yourself instead of copying them. Your fingers learn the shape of the language, and the small mistakes you make teach you how to read errors.",
        "Break every task into steps small enough that you could explain them to a child. A program is only that list, written precisely.",
    ],
}
LESSONS = [
    ("Mathematics", "Algebra", "article", "Solving linear equations without fear", "One clear method that works every time", "free"),
    ("Mathematics", "Algebra", "video", "Quadratic equations, step by step", "Factoring, completing the square and the formula", "paid"),
    ("Mathematics", "Algebra", "document", "Form Four algebra revision pack", "Forty worked problems with full solutions", "paid"),
    ("Mathematics", "Geometry", "article", "Why the angles of a triangle add up to 180", "A proof you can do with a sheet of paper", "free"),
    ("Mathematics", "Geometry", "mixed", "Circle theorems for national exams", "Every theorem, with exam-style examples", "paid"),
    ("Mathematics", "Statistics", "article", "Mean, median and mode in real life", "Which average tells the truth about your data", "free"),
    ("Sciences", "Physics", "video", "Forces and motion in everyday life", "Newton's laws on a daladala", "free"),
    ("Sciences", "Physics", "article", "Electricity at home explained", "Current, voltage and your LUKU bill", "paid"),
    ("Sciences", "Chemistry", "document", "Periodic table study notes", "Trends and groups on four printable pages", "free"),
    ("Sciences", "Chemistry", "article", "Acids and bases in the kitchen", "Simple tests with lemon, soap and baking soda", "free"),
    ("Sciences", "Biology", "audio", "The human heart: a guided listen", "A calm walk through circulation for revision", "paid"),
    ("Sciences", "Biology", "article", "How vaccines teach the body", "Memory cells, explained without jargon", "free"),
    ("Languages", "English", "article", "Writing a strong composition", "A structure that works for any exam topic", "paid"),
    ("Languages", "English", "audio", "Everyday English listening practice", "Short conversations with useful phrases", "free"),
    ("Languages", "Kiswahili", "article", "Kuandika insha bora", "Muundo rahisi wa insha yenye mvuto", "free"),
    ("Languages", "Kiswahili", "document", "Mwongozo wa fasihi kwa kidato cha nne", "Muhtasari wa vitabu vya fasihi", "paid"),
    ("Business", "Bookkeeping", "article", "A daily cash book for your shop", "The ten-minute habit that saves businesses", "free"),
    ("Business", "Bookkeeping", "document", "Bookkeeping templates for small traders", "Ready-to-print sales and expense sheets", "paid"),
    ("Business", "Marketing", "video", "Selling on WhatsApp and Instagram", "Photos, pricing and replies that convert", "paid"),
    ("Business", "Marketing", "article", "How to price what you sell", "Cost, value and the mistake of copying neighbours", "paid"),
    ("Technology", "Programming", "article", "Your first Python program", "From nothing installed to a working calculator", "free"),
    ("Technology", "Programming", "mixed", "Python for absolute beginners", "Variables, loops and functions, with exercises", "paid"),
    ("Technology", "Spreadsheets", "article", "Spreadsheets for your family budget", "Formulas that answer real money questions", "free"),
    ("Technology", "Spreadsheets", "document", "Excel shortcuts cheat sheet", "The thirty shortcuts worth learning", "free"),
]
COMMENTS = ["This finally made sense to me, thank you teacher.", "Can you do one more example on the last part?",
            "I used this method in my mock exam and it worked.", "Very clear. Please add more practice questions.",
            "Asante sana mwalimu, somo zuri sana.", "I had been stuck on this for weeks.",
            "The part about going back to the definition really helped."]


def font(size, serif=False):
    names = ["DejaVuSerif-Bold.ttf" if serif else "DejaVuSans-Bold.ttf"]
    for name in names:
        for root in ("/usr/share/fonts/truetype/dejavu", ""):
            try:
                return ImageFont.truetype(str(Path(root) / name), size)
            except OSError:
                continue
    return ImageFont.load_default()


def mix(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def rgb(color):
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))


def cover_image(title, color, kind):
    """A generated editorial cover: deep gradient, soft geometry, one big glyph."""
    w, h = 1280, 720
    base = rgb(color)
    dark, light = mix(base, (10, 10, 20), 0.55), mix(base, (255, 255, 255), 0.15)
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(0, w):
            t = (x / w * 0.65 + y / h * 0.35)
            px[x, y] = mix(light, dark, t)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    seed = sum(map(ord, title))
    rng = random.Random(seed)
    if seed % 3 == 0:
        for i in range(9):
            r = 90 + i * 70
            draw.ellipse((w - r - 80, h - r - 40, w + r - 80, h + r - 40), outline=(255, 255, 255, 26), width=2)
    elif seed % 3 == 1:
        for i in range(0, w + h, 56):
            draw.line((i, 0, i - h, h), fill=(255, 255, 255, 16), width=2)
    else:
        for _ in range(26):
            x, y, s = rng.randint(0, w), rng.randint(0, h), rng.randint(14, 90)
            draw.rounded_rectangle((x, y, x + s, y + s), radius=s // 4, fill=(255, 255, 255, rng.randint(8, 22)))
    img = Image.alpha_composite(img.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(img)
    glyph = {"article": "Aa", "video": "▶", "audio": "♪", "document": "≡", "mixed": "∑"}[kind]
    draw.text((72, h - 250), glyph, font=font(190, serif=kind == "article"), fill=(255, 255, 255, 235))
    return img.convert("RGB")


def text_doc(category, title, *extra):
    paras = PARAS[category]
    def p(text):
        return {"type": "paragraph", "content": [{"type": "text", "text": text}]}
    def h(text, level=2):
        return {"type": "heading", "attrs": {"level": level}, "content": [{"type": "text", "text": text}]}
    blocks = [
        p(paras[0]),
        p(paras[1]),
        h("The main idea"),
        p(paras[2]),
        {"type": "callout", "attrs": {"variant": "tip"}, "content": [p("Work through this lesson with a pencil. Understanding comes from doing.")]},
        h("A worked example"),
        p(f"Let us apply this to {title.lower()}. Read each step, then cover the page and try it yourself."),
        {"type": "orderedList", "content": [
            {"type": "listItem", "content": [p(t)]} for t in
            ("Write down what you know.", "Decide what you need to find.", "Choose the method that connects them.",
             "Check your answer makes sense.")]},
        {"type": "blockquote", "content": [p("A mistake you understand is worth more than an answer you copied.")]},
        h("Common mistakes"),
        p(paras[1]),
        {"type": "table", "content": [
            {"type": "tableRow", "content": [
                {"type": "tableHeader", "content": [p("Mistake")]}, {"type": "tableHeader", "content": [p("Better habit")]}]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "content": [p("Rushing to the formula")]},
                {"type": "tableCell", "content": [p("Start with an example")]}]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "content": [p("Skipping the check")]},
                {"type": "tableCell", "content": [p("Test your answer in the question")]}]},
        ]},
        h("Practice"),
        p(paras[2]),
        {"type": "taskList", "content": [
            {"type": "taskItem", "attrs": {"checked": False}, "content": [p(t)]} for t in
            ("Read the lesson once without notes", "Redo the example from memory", "Teach it to someone else")]},
        *extra,
        p(paras[0]),
    ]
    return {"type": "doc", "content": blocks}


class Command(BaseCommand):
    help = "Load realistic demo data."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true")
        parser.add_argument("--skip-video", action="store_true")

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError("Seeding is for development. Use --force to run it with DEBUG off.")
        self.skip_video = options["skip_video"]
        if Content.objects.exists():
            self.stdout.write("Demo data already present, nothing to do.")
            return
        self.tmp = Path(tempfile.mkdtemp())
        self.site()
        admin, editor, students = self.users()
        plans = self.plans()
        cats = self.categories()
        contents = self.contents(admin, cats)
        self.orders(students, plans, contents)
        self.engagement(admin, students, contents)
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(contents)} contents.\nAdmin: {ADMIN_PHONE} / {DEMO_PASSWORD}\n"
            f"Editor: {EDITOR_PHONE} / {DEMO_PASSWORD}\nStudent: {students[0].phone} / {DEMO_PASSWORD}"))

    def site(self):
        s = SiteSettings.objects.get_or_create(pk=1)[0]
        s.contact_email, s.contact_phone = "hello@darasa.example", "+255 754 000 001"
        s.social_links = {"instagram": "https://instagram.com/", "youtube": "https://youtube.com/"}
        s.faq = [
            {"q": "Do I need an account to read free lessons?", "a": "No. Free lessons are open to everyone."},
            {"q": "How do I pay?", "a": "By mobile money: M-Pesa, Airtel Money, Mixx by Yas or Halotel. You approve a prompt on your phone."},
            {"q": "What happens after I pay?", "a": "Your account is created automatically and the lesson unlocks right away."},
            {"q": "Can I cancel my subscription?", "a": "Subscriptions do not renew by themselves. You pay again only if you want to continue."},
        ]
        s.save()

    def users(self):
        admin = User.objects.create_student(ADMIN_PHONE, DEMO_PASSWORD, role="admin", first_name="Mwalimu",
                                            last_name="Amani", is_staff=True, is_superuser=True,
                                            source="admin_created", email="teacher@darasa.example")
        editor = User.objects.create_student(EDITOR_PHONE, DEMO_PASSWORD, role="editor", first_name="Grace",
                                             last_name="Kessy", source="admin_created")
        students = []
        for i in range(40):
            first, last = R.choice(FIRST), R.choice(LAST)
            source = "auto_created_by_payment" if i % 3 == 0 and i else "self_signup"
            user = User.objects.create_student(f"25575410{i:04d}", DEMO_PASSWORD, first_name=first, last_name=last,
                                               source=source, must_change_password=False)
            User.objects.filter(pk=user.pk).update(
                date_joined=timezone.now() - timedelta(days=R.randint(0, 120)),
                last_seen=timezone.now() - timedelta(hours=R.randint(1, 400)))
            students.append(user)
        return admin, editor, students

    def plans(self):
        base = ["All paid lessons included", "New lessons every week", "Download notes and worksheets",
                "Ask questions in comments"]
        rows = [("Monthly", "Everything, one month at a time.", 15000, 30, base, False, 0),
                ("Term", "Three months, for one school term.", 39000, 90, [*base, "Save 13% over monthly"], True, 1),
                ("Year", "A full year of learning.", 129000, 365, [*base, "Save 28% over monthly"], False, 2)]
        return [SubscriptionPlan.objects.create(name=n, description=d, price=p, duration_days=t, features=f,
                                                highlighted=h, order=o) for n, d, p, t, f, h, o in rows]

    def categories(self):
        out = {}
        for i, (name, color, icon, desc, subs) in enumerate(TREE):
            parent = Category.objects.create(name=name, color=color, icon=icon, description=desc, order=i)
            out[name] = parent
            for j, sub in enumerate(subs):
                out[sub] = Category.objects.create(name=sub, color=color, icon=icon, parent=parent, order=j)
        return out

    def cover(self, title, color, kind):
        storage = get_storage()
        img = cover_image(title, color, kind)
        name = uuid.uuid4().hex
        full, thumb = f"public/covers/{name}.webp", f"public/covers/{name}-w640.webp"
        storage.put_bytes(full, webp(img, 1280), "image/webp", public=True)
        storage.put_bytes(thumb, webp(img, 640, 76), "image/webp", public=True)
        return full, thumb

    def register(self, name, data, admin, content=None):
        from apps.media_library.validation import kind_from_name, sniff

        asset_id = uuid.uuid4()
        key = f"uploads/{asset_id}/{name}"
        get_storage().put_bytes(key, data)
        asset = MediaAsset.objects.create(id=asset_id, kind=kind_from_name(name), original_filename=name,
                                          storage_key=key, size=len(data), mime=sniff(data[:8192]), uploaded_by=admin,
                                          status="uploaded", content=content)
        process(asset)
        asset.refresh_from_db()
        return asset

    def pdf(self, title, pages=8):
        sheets = []
        for page in range(1, pages + 1):
            img = Image.new("RGB", (1240, 1754), "white")
            d = ImageDraw.Draw(img)
            d.rectangle((0, 0, 1240, 16), fill=(79, 70, 229))
            d.text((110, 130), title[:42], font=font(46, True), fill=(20, 20, 30))
            d.text((110, 210), f"Page {page} of {pages}", font=font(26), fill=(120, 120, 130))
            y = 320
            rng = random.Random(page * 13)
            while y < 1580:
                d.rectangle((110, y, 110 + rng.randint(600, 1020), y + 16), fill=(226, 228, 233))
                y += 52 if rng.random() > 0.2 else 96
            sheets.append(img)
        buf = io.BytesIO()
        sheets[0].save(buf, "PDF", save_all=True, append_images=sheets[1:], resolution=150)
        return buf.getvalue()

    def media_file(self, name, cmd):
        path = self.tmp / name
        subprocess.run(["ffmpeg", "-y", "-v", "error", *cmd, str(path)], check=True, timeout=300)
        return path.read_bytes()

    def video(self):
        return self.media_file("lesson.mp4", [
            "-f", "lavfi", "-i", "gradients=s=640x360:d=24:c0=0x4F46E5:c1=0x0D9488:speed=0.02",
            "-f", "lavfi", "-i", "sine=frequency=220:duration=24", "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])

    def audio(self):
        return self.media_file("lesson.mp3", [
            "-f", "lavfi", "-i", "sine=frequency=196:duration=90", "-c:a", "libmp3lame", "-q:a", "6"])

    def contents(self, admin, cats):
        now = timezone.now()
        rows = []
        video_bytes = None if self.skip_video else self.video()
        audio_bytes = self.audio()
        pdf_book = self.register("student-handbook.pdf", self.pdf("Student Handbook", 12), admin)
        for i, (top, sub, kind, title, subtitle, access) in enumerate(LESSONS):
            color = next(t[1] for t in TREE if t[0] == top)
            full, thumb = self.cover(title, color, kind)
            published = now - timedelta(days=i * 3 + 1, hours=R.randint(0, 20))
            extra = [{"type": "paragraph", "content": [
                {"type": "text", "text": "Before you go, "},
                {"type": "text", "text": "click here to get your handbook", "marks": [
                    {"type": "fileLink", "attrs": {"assetId": str(pdf_book.pk)}}]},
                {"type": "text", "text": " and keep it with your notes."}]}]
            content = Content(
                title=title, subtitle=subtitle, excerpt=f"{subtitle}. {PARAS[top][0][:110]}…", cover_image=full,
                cover_thumb=thumb, category=cats[sub], author=admin, content_type=kind,
                body_json=text_doc(top, title, *extra), access_level=access,
                price=R.choice([2000, 3000, 5000, 7500]) if access == "paid" else None,
                status="published", published_at=published, featured=i in (1, 4, 6, 12, 21),
                view_count=R.randint(40, 4800), access_duration_days=None if i % 5 else 180,
                preview_seconds=12,
            )
            services.ensure_slug(content)
            content.save()
            if kind in ("video", "mixed") and video_bytes:
                content.main_asset = self.register("lesson-recording.mp4", video_bytes, admin, content)
            elif kind == "audio":
                content.main_asset = self.register("lesson-audio.mp3", audio_bytes, admin, content)
            elif kind == "document":
                content.main_asset = self.register(f"{content.slug[:40]}.pdf", self.pdf(title), admin, content)
            content.save()
            tags = [Tag.objects.get_or_create(name=t)[0] for t in (top, kind.title(), "Exam prep" if i % 3 == 0 else "Beginner")]
            content.tags.set(tags)
            services.refresh_derived(content)
            services.snapshot_revision(content, admin, "Published")
            rows.append(content)
        extras = [("Draft: ratios and proportion", "draft"), ("Coming soon: trigonometry basics", "scheduled")]
        for title, status in extras:
            content = Content(title=title, subtitle="Work in progress", author=admin, category=cats["Algebra"],
                              body_json=text_doc("Mathematics", title), status=status,
                              scheduled_for=now + timedelta(days=5) if status == "scheduled" else None)
            services.ensure_slug(content)
            content.save()
            services.refresh_derived(content)
        return rows

    def orders(self, students, plans, contents):
        paid = [c for c in contents if c.access_level == "paid"]
        for i in range(70):
            user = R.choice(students)
            when = timezone.now() - timedelta(days=R.randint(0, 40), hours=R.randint(0, 23))
            subscription = R.random() < 0.4
            status = R.choices(["completed", "failed", "expired", "cancelled"], [8, 1, 1, 1])[0]
            item = R.choice(plans) if subscription else R.choice(paid)
            order_id = uuid.uuid4()
            order = Order(id=order_id, user=user, phone=user.phone, first_name=user.first_name, last_name=user.last_name,
                          order_type="subscription" if subscription else "content_purchase",
                          content=None if subscription else item, plan=item if subscription else None,
                          item_title=item.title if not subscription else item.name,
                          amount=item.effective_price, status=status, idempotency_key=order_id.hex[:30],
                          snippe_reference=f"pi_{order_id.hex[:12]}",
                          payment_provider=R.choice(["mpesa", "airtel", "mixx", "halotel"]), payment_channel="mobile_money",
                          plan_duration_days=item.duration_days if subscription else None,
                          paid_at=when if status == "completed" else None,
                          timeline=[{"at": when.isoformat(), "event": "created", "detail": ""},
                                    {"at": when.isoformat(), "event": "push_sent", "detail": ""},
                                    {"at": when.isoformat(), "event": f"payment_{status}", "detail": "webhook"}])
            order.save()
            Order.objects.filter(pk=order.pk).update(created_at=when)
            if status == "completed":
                Entitlement.objects.create(
                    user=user, kind="subscription" if subscription else "content", plan=item if subscription else None,
                    content=None if subscription else item, order=order, starts_at=when,
                    expires_at=when + timedelta(days=item.duration_days) if subscription else None)

    def engagement(self, admin, students, contents):
        for content in contents:
            for student in R.sample(students, R.randint(0, 6)):
                Reaction.objects.create(content=content, user=student)
            top = None
            for _ in range(R.randint(0, 4)):
                top = Comment.objects.create(content=content, user=R.choice(students), body=R.choice(COMMENTS),
                                             status=R.choices(["approved", "pending"], [6, 1])[0])
            if top and top.status == "approved" and R.random() < 0.6:
                Comment.objects.create(content=content, user=admin, parent=top, is_pinned=False,
                                       body="Glad it helped. Try the practice section next, and tell me how it goes.")
        first = students[0]
        Entitlement.objects.create(user=first, kind="subscription", plan=SubscriptionPlan.objects.first(),
                                   expires_at=timezone.now() + timedelta(days=11), granted_by="admin", reason="Demo")
        for content in contents[:4]:
            Bookmark.objects.get_or_create(user=first, content=content)
            ReadingProgress.objects.update_or_create(user=first, content=content,
                                                     defaults={"percent": R.randint(15, 80)})


__all__ = ["math"]
