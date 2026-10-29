"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CharacterRow {
  id: number;
  name: string;
  world_id: number;
  world_name: string;
  is_active: number;
}

interface WorldOption { id: number; name: string; }

export default function CharactersPage() {
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [name, setName] = useState("");
  const [worldId, setWorldId] = useState<number | "">("");

  const load = () =>
    fetch("/api/characters").then((r) => r.json()).then(setCharacters);

  useEffect(() => {
    load();
    fetch("/api/worlds").then((r) => r.json()).then(setWorlds);
  }, []);

  const create = async () => {
    if (!name.trim() || !worldId) {
      alert("세계관과 이름을 입력하세요.");
      return;
    }
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ world_id: worldId, name: name.trim() }),
    });
    if (!res.ok) {
      const r = await res.json().catch(() => ({}));
      alert(r.error ?? "생성 실패");
      return;
    }
    setName("");
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("캐릭터를 삭제할까요? 일러스트/관계 설정도 함께 삭제됩니다.")) return;
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <h2>캐릭터 관리</h2>
      <div className="panel">
        <div className="row">
          <div>
            <label>세계관</label>
            <select value={worldId} onChange={(e) => setWorldId(Number(e.target.value) || "")}>
              <option value="">선택...</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>새 캐릭터 이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <button style={{ marginTop: 0 }} onClick={create}>추가</button>
          </div>
        </div>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr><th>ID</th><th>이름</th><th>세계관</th><th>상태</th><th></th></tr>
          </thead>
          <tbody>
            {characters.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td><Link href={`/characters/${c.id}`}>{c.name}</Link></td>
                <td>{c.world_name}</td>
                <td>{c.is_active ? "활성" : "비활성"}</td>
                <td><button className="danger small" onClick={() => remove(c.id)}>삭제</button></td>
              </tr>
            ))}
            {characters.length === 0 && (
              <tr><td colSpan={5} className="muted">등록된 캐릭터가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
