"use client";

import { useEffect, useState } from "react";
import { IconCopy, IconDownload, IconPlus, IconTrash } from "@tabler/icons-react";
import { api } from "../_components/api";
import "./mcp-access-panel.css";

type AccessToken = { id: string; name: string; prefix: string; readOnly: boolean; expiresAt: string; lastUsedAt: string | null };

export function McpAccessPanel() {
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [name, setName] = useState("AI 审阅助手");
  const [readOnly, setReadOnly] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const data = await api<{ tokens: AccessToken[] }>("/users/me/api-tokens");
    setTokens(data.tokens);
  }
  useEffect(() => {
    setEndpoint(`${location.origin}/api/mcp`);
    void refresh().catch(() => setError("访问令牌加载失败。"));
  }, []);

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage("已复制。"); }
    catch { setError("无法访问剪贴板，请选中文字复制。"); }
  }

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true); setError(""); setMessage(""); setCreatedToken(null);
    try {
      const data = await api<{ token: string }>("/users/me/api-tokens", { method: "POST", body: JSON.stringify({ name: name.trim(), readOnly, expiresInDays }) });
      setCreatedToken(data.token);
      await refresh();
    } catch { setError("令牌创建失败，请检查名称或稍后重试。"); }
    finally { setBusy(false); }
  }

  async function revoke(token: AccessToken) {
    if (busy || !window.confirm(`撤销“${token.name}”的访问权限？`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/users/me/api-tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
      if (createdToken?.startsWith(token.prefix)) setCreatedToken(null);
      await refresh();
      setMessage("访问令牌已撤销。");
    } catch { setError("撤销失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  return (
    <section className="mr-panel mr-page__card mr-mcp-access">
      <div className="mr-page__section-kicker">Integrations</div>
      <h2 className="mr-page__section-title">AI 与 MCP</h2>
      <label className="mr-field">
        <span className="mr-field__label">远程 MCP 地址</span>
        <span className="mr-mcp-access__copy-row">
          <input className="mr-input" aria-label="远程 MCP 地址" value={endpoint} readOnly />
          <button className="mr-icon-btn" type="button" title="复制 MCP 地址" aria-label="复制 MCP 地址" onClick={() => void copy(endpoint)}><IconCopy size={18} /></button>
        </span>
      </label>
      <div className="mr-mcp-access__form">
        <label className="mr-field"><span className="mr-field__label">令牌名称</span><input className="mr-input" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="mr-field"><span className="mr-field__label">有效期</span><select className="mr-input" value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option><option value={365}>365 天</option></select></label>
      </div>
      <label className="mr-mcp-access__check"><input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />仅允许读取</label>
      <div className="mr-page__actions"><button className="mr-btn mr-btn--primary" type="button" disabled={busy || !name.trim()} onClick={() => void create()}><IconPlus size={16} />创建访问令牌</button><a className="mr-btn" href="/api/integrations/markreel-skill.zip" download><IconDownload size={16} />下载操作 Skill</a></div>
      {createdToken ? <div className="mr-mcp-access__secret" role="status"><strong>令牌仅显示一次</strong><span className="mr-mcp-access__copy-row"><input className="mr-input" aria-label="新创建的访问令牌" readOnly value={createdToken} /><button className="mr-icon-btn" type="button" title="复制访问令牌" aria-label="复制访问令牌" onClick={() => void copy(createdToken)}><IconCopy size={18} /></button></span></div> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="mr-mcp-access__error">{error}</p> : null}
      <ul className="mr-mcp-access__tokens" aria-label="访问令牌">
        {tokens.map((token) => <li key={token.id}><div><strong>{token.name}</strong><small>{token.prefix}… · {token.readOnly ? "只读" : "当前账号权限"} · {new Date(token.expiresAt).toLocaleDateString()} 到期</small></div><button className="mr-icon-btn" type="button" title={`撤销 ${token.name}`} aria-label={`撤销 ${token.name}`} disabled={busy} onClick={() => void revoke(token)}><IconTrash size={18} /></button></li>)}
      </ul>
    </section>
  );
}
