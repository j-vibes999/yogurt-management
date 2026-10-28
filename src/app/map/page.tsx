import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { StoreMap } from "@/components/store-map";
import { getMapData } from "@/lib/db-data";
import { getCurrentSession } from "@/lib/server-session";
import { canRoleOpen } from "@/lib/access-policy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MapPage() {
  noStore();
  const [{ source, stores: mapStores }, session] = await Promise.all([getMapData(), getCurrentSession()]);

  return (
    <>
      <div className="page map-page-v4 workspace-color-page color-domain-stores">
        <div className="page-header map-page-header-v4 color-page-header">
          <div>
            <div className="eyebrow">ຕຳແໜ່ງຮ້ານ</div>
            <h1>ແຜນທີ່ຮ້ານ</h1>
            <p>ຄົ້ນຫາຮ້ານ, ເບິ່ງຈຳນວນຄົງເຫຼືອ/ສະຖານະຕູ້, ຮອບກວດ, ການເຕີມສິນຄ້າ ແລະຍອດຄ້າງໃນໜ້າດຽວ.</p>
          </div>
          <div className="page-actions">
            {canRoleOpen(session?.role, "/driver") && <Link prefetch={false} className="button button-secondary" href="/driver">ຮອບກວດ</Link>}
            {canRoleOpen(session?.role, "/stores/new") && <Link prefetch={false} className="button button-primary" href="/stores/new">+ ເພີ່ມຮ້ານ</Link>}
          </div>
        </div>

        {source === "demo" && (
          <div className="notice" style={{ marginBottom: 16 }}>
            <strong>ໂໝດສາທິດ</strong><br />ສະຖານະໃນແຜນທີ່ຈະອັບເດດຈາກ PostgreSQL ເມື່ອ database ເຮັດວຽກ.
          </div>
        )}

        <StoreMap stores={mapStores} role={session?.role ?? null} />
      </div>
    </>
  );
}
