import ConstantiaStream from "./ConstantiaStream";

export const dynamic = "force-dynamic";

/** 라스트오리진 '콘스탄챠 S2' 방송 페이지 (2D 일러스트 버튜버) */
export default async function ConstantiaPage() {
  return (
    <div className="haru-live">
      <section className="haru-live-stage" aria-label="콘스탄챠 방송 화면">
        <ConstantiaStream />
      </section>
    </div>
  );
}
