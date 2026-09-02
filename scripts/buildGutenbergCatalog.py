"""
把 Gutenberg 的官方目录 CSV 压成 App 里能带着走的一份小目录。

原始 CSV 有 9 万条、21MB，字段一大堆（主题分类、图书馆编号、书架……），
App 里搜书只需要三样：编号、书名、作者。编号能拼出下载地址，
另外两样是用来搜的。

产物是制表符分隔的纯文本再 gzip，App 启动时用 fflate 解开（epub 解析已经在用这个库）。
之所以不用 JSON：6 万多条记录，光引号和括号就要多占近 1MB。

用法：python scripts/buildGutenbergCatalog.py <pg_catalog.csv> <输出.gz>
目录来源：https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv
"""

import csv
import gzip
import re
import sys

# 作者字段长这样："Austen, Jane, 1775-1817"，年份对搜索没用，去掉省地方
YEARS = re.compile(r",\s*\d{3,4}\??\s*-\s*\d{0,4}\??\s*$")


def clean_author(raw: str) -> str:
    if not raw:
        return ""
    # 多个作者用分号隔开，只留前两个 —— 再多在手机上也显示不下
    names = [YEARS.sub("", n.strip()) for n in raw.split(";")]
    names = [n for n in names if n]
    return "; ".join(names[:2])


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    rows = []
    with open(src, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            # 只要英文的正文书。Type 还有 Sound / Image / Dataset 等，不是能读的东西
            if r["Type"] != "Text" or r["Language"] != "en":
                continue
            title = " ".join(r["Title"].split())  # 书名里有换行，压成一行
            if not title:
                continue
            rows.append((int(r["Text#"]), title, clean_author(r["Authors"])))

    rows.sort(key=lambda x: x[0])
    body = "\n".join(f"{i}\t{t}\t{a}" for i, t, a in rows)
    raw = body.encode("utf-8")
    with gzip.open(dst, "wb", compresslevel=9) as out:
        out.write(raw)

    print(f"书目 {len(rows)} 本")
    print(f"解开后 {len(raw) / 1024 / 1024:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
