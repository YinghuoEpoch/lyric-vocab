"""
把两个古登堡站点的书目压成 App 里能带着走的一份小目录。

App 里搜书只需要四样：**哪个源、怎么找到它、书名、作者**。
后两样是拿来搜的，前两样是拿来拼下载地址的。

## 两个源

- **美国站**（gutenberg.org）：官方目录是一份 CSV，9 万条 21MB。
  版权按「1929 年以前」算，所以全是老书。给 epub。
  ref 是书的编号，地址由它拼出来。
- **澳洲站**（gutenberg.net.au）：目录是一份纯文本，两行一条。
  版权按「作者去世满 50 年」算，**所以有二十世纪的东西** ——
  《1984》《动物农场》都在。给 txt（也有很多只有网页版，那些不要）。
  ref 是站内路径，因为它的地址没有规律可循。

两个源在 App 里是**合成一个书库**搜的，用户不必知道哪本书来自哪边。

## 产物

制表符分隔的纯文本再 gzip，App 启动时用 fflate 解开（epub 解析已经在用这个库）。
每行 `源\t定位\t书名\t作者`，源是 `g`（美国）或 `a`（澳洲）。
不用 JSON：六万多条记录，光引号和括号就要多占近 1MB。

用法：
    python scripts/buildGutenbergCatalog.py <pg_catalog.csv> <gutindex_aus.txt> <输出.bin>

两份目录的来源：
    https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv
    http://gutenberg.net.au/gutindex_aus.txt
"""

import csv
import gzip
import re
import sys

# 美国站的作者字段长这样："Austen, Jane, 1775-1817"，年份对搜索没用，去掉省地方
YEARS = re.compile(r",\s*\d{3,4}\??\s*-\s*\d{0,4}\??\s*$")
# 澳洲站的目录行："Aug 2001 Animal Farm, by George Orwell   [010001xx.xxx] 0001A"
AUS_DATE = re.compile(r"^\w{3,4}\s+\d{4}\s+")
AUS_TAIL = re.compile(r"\s*\[[^\]]*\].*$")
AUS_URL = re.compile(r"^https?://gutenberg\.net\.au/(\S+)")


def clean_us_author(raw: str) -> str:
    if not raw:
        return ""
    # 多个作者用分号隔开，只留前两个 —— 再多在手机上也显示不下
    names = [YEARS.sub("", n.strip()) for n in raw.split(";")]
    return "; ".join([n for n in names if n][:2])


def read_us(path):
    rows = []
    with open(path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            # 只要英文的正文书。Type 还有 Sound / Image / Dataset 等，不是能读的东西
            if r["Type"] != "Text" or r["Language"] != "en":
                continue
            title = " ".join(r["Title"].split())  # 书名里有换行，压成一行
            if not title:
                continue
            rows.append(("g", r["Text#"], title, clean_us_author(r["Authors"])))
    return rows


def split_aus(meta: str):
    """把「书名, by 作者」拆开。没有「by」的就按最后一个逗号断，这是这份目录的惯例。"""
    m = AUS_TAIL.sub("", AUS_DATE.sub("", meta)).strip()
    m = re.sub(r"\s{2,}", " ", m)
    if not m:
        return None
    low = m.lower()
    at = low.rfind(", by ")
    if at != -1:
        return m[:at].strip(), m[at + 5 :].strip()
    if "," in m:
        title, author = m.rsplit(",", 1)
        author = author.strip()
        # 逗号后面太长多半不是人名，是书名自己的一部分
        if 2 < len(author) < 40:
            return title.strip(), author
    return m, ""


def read_aus(path):
    """
    目录是「一行说明 + 一行或多行地址」。同一本书可能同时列出 txt 和 html，
    **只要 txt** —— 网页版得先剥标签才能用，那是另一个导入器的活，暂时不做。
    """
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    rows, meta = [], None
    pending = []

    def flush():
        if not meta or not pending:
            return
        txt = next((u for u in pending if u.lower().endswith(".txt")), None)
        if not txt:
            return
        parsed = split_aus(meta)
        if parsed and parsed[0]:
            rows.append(("a", txt, parsed[0], parsed[1]))

    for line in lines:
        s = line.strip()
        hit = AUS_URL.match(s)
        if hit:
            pending.append(hit.group(1))
            continue
        if s:
            flush()
            meta, pending = s, []
    flush()
    return rows


def main() -> int:
    us_csv, aus_txt, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    us, aus = read_us(us_csv), read_aus(aus_txt)

    # 澳洲站排前面：那边有二十世纪的书，搜同一个作者时更可能是用户想要的
    rows = aus + us
    body = "\n".join("\t".join(r) for r in rows)
    raw = body.encode("utf-8")
    with gzip.open(dst, "wb", compresslevel=9) as out:
        out.write(raw)

    print(f"澳洲站 {len(aus)} 本（纯文本的）")
    print(f"美国站 {len(us)} 本")
    print(f"合计 {len(rows)} 本，解开后 {len(raw) / 1024 / 1024:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
