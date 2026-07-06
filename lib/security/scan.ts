// Güvenlik tarayıcı (security-guidance eşdeğeri): dosya yazımından önce/sonra
// bilinen açık kalıplarını arar ve UYARIR (engellemez — tavsiye niteliğinde).
// Kaynak fikir: claude.com/plugins/security-guidance (Anthropic).

export type SecFinding = { rule: string; line: number; snippet: string; hint: string };

const RULES: {
  id: string;
  re: RegExp;
  hint: string;
  exts?: string[]; // sadece bu uzantılarda ara
}[] = [
  {
    id: "eval",
    re: /\beval\s*\(/,
    hint: "eval() rastgele kod çalıştırır — kaldır ya da güvenli ayrıştırma kullan.",
  },
  {
    id: "new-Function",
    re: /\bnew\s+Function\s*\(/,
    hint: "new Function() eval gibidir — dinamik kod üretmekten kaçın.",
  },
  {
    id: "child_process-exec",
    re: /\b(?:child_process\.)?exec(?:Sync)?\s*\(\s*[`'\"]?[^)]*[$+]/,
    hint: "exec() komut enjeksiyonuna açık — execFile/spawn ile argümanları dizi olarak ver.",
  },
  {
    id: "innerHTML",
    re: /\.innerHTML\s*=/,
    hint: "innerHTML XSS riski — textContent veya sanitize edilmiş DOM kullan.",
  },
  {
    id: "dangerouslySetInnerHTML",
    re: /dangerouslySetInnerHTML/,
    hint: "dangerouslySetInnerHTML XSS riski — içeriği DOMPurify vb. ile temizle.",
  },
  {
    id: "os.system",
    re: /\bos\.system\s*\(/,
    hint: "os.system() komut enjeksiyonu — subprocess.run([...]) kullan.",
    exts: [".py"],
  },
  {
    id: "pickle",
    re: /\bpickle\.loads?\s*\(/,
    hint: "pickle güvenilmeyen veride kod çalıştırabilir — json tercih et.",
    exts: [".py"],
  },
  {
    id: "gha-injection",
    re: /\$\{\{\s*(?:github\.event|inputs|env)\./,
    hint: "GitHub Actions ${{ }} ifadesini run: içine gömme — env değişkeniyle aktar (enjeksiyon).",
    exts: [".yml", ".yaml"],
  },
];

function extOf(path: string): string {
  const m = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

export function scanContent(path: string, content: string): SecFinding[] {
  if (!content) return [];
  const ext = extOf(path);
  const lines = content.split("\n");
  const found: SecFinding[] = [];
  for (const rule of RULES) {
    if (rule.exts && !rule.exts.includes(ext)) continue;
    for (let i = 0; i < lines.length; i++) {
      if (rule.re.test(lines[i])) {
        found.push({
          rule: rule.id,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 120),
          hint: rule.hint,
        });
        if (found.length >= 20) return found;
        break; // kural başına ilk eşleşme yeter
      }
    }
  }
  return found;
}

// Bulguları tek satırlık uyarı metnine çevir (araç sonucuna eklenir).
export function formatFindings(findings: SecFinding[]): string {
  if (findings.length === 0) return "";
  const lines = findings.map(
    (f) => `  • satır ${f.line} [${f.rule}]: ${f.hint}`,
  );
  return `\n\n⚠️ GÜVENLİK UYARISI (${findings.length}) — yazıldı ama gözden geçir:\n${lines.join("\n")}`;
}
