import asyncio
import json
import os
import secrets
import urllib.error
import urllib.request
from datetime import datetime
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, joinedload

from pydantic import BaseModel

from marketplace_browser_scrape import scrape_lazada_sync, scrape_shopee_sync
from auth import create_access_token, hash_password, verify_password
from database import Base, engine
from deps import get_current_user, get_db, require_role
from models import (
    Ingredient,
    LocalStore,
    LocalStoreProduct,
    MonthlyFinancialSnapshot,
    Opex,
    OtherCost,
    Recipe,
    RecipeIngredient,
    RecipeOtherCost,
    User,
    UserWorkspace,
)
from schemas import (
    GoogleAuthIn,
    IngredientCreateIn,
    IngredientOut,
    LocalStoreDetailOut,
    LocalStoreOut,
    LocalStoreProductCreateIn,
    LocalStoreProductOut,
    LocalStoreProductUpdateIn,
    LocalStoreUpdateIn,
    MonthlySnapshotCreateIn,
    MonthlySnapshotOut,
    OpexCreateIn,
    OpexOut,
    OtherCostCreateIn,
    OtherCostOut,
    RecipeCreateIn,
    RecipeDetailsOut,
    RecipeIngredientCreateIn,
    RecipeIngredientOut,
    RecipeOtherCostCreateIn,
    RecipeOtherCostOut,
    RecipeOut,
    SmartPricingAnalyzeIn,
    TokenOut,
    PasswordChangeIn,
    UserOut,
    UserRegisterIn,
    WorkspaceState,
    convert_to_base,
)
from ml.smart_pricing import analyze_smart_pricing

app = FastAPI(title="PriceWise Backend", version="2.0.0")
Base.metadata.create_all(bind=engine)


def _migrate_monthly_snapshots_allow_duplicates() -> None:
    """Allow multiple Summary saves for the same calendar month (drop legacy unique on user_id+year_month)."""
    with engine.begin() as conn:
        dialect = conn.dialect.name
        if dialect == "postgresql":
            conn.execute(
                text(
                    "ALTER TABLE monthly_financial_snapshots DROP CONSTRAINT IF EXISTS uq_monthly_snap_user_month"
                )
            )
        elif dialect == "sqlite":
            tbl = "monthly_financial_snapshots"
            exists = conn.execute(
                text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n"), {"n": tbl}
            ).scalar()
            if not exists:
                pass
            else:
                ddl = conn.execute(
                    text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:n"), {"n": tbl}
                ).scalar_one_or_none()
                if ddl and "UNIQUE" in ddl.upper():
                    mig = f"{tbl}_dedupe_mig"
                    conn.execute(text(f"DROP TABLE IF EXISTS {mig}"))
                    conn.execute(
                        text(
                            f"""
                            CREATE TABLE {mig} (
                              id INTEGER NOT NULL PRIMARY KEY,
                              user_id INTEGER NOT NULL,
                              year_month VARCHAR(7) NOT NULL,
                              total_opex REAL NOT NULL,
                              total_revenue REAL NOT NULL,
                              gross_profit REAL NOT NULL,
                              net_profit REAL NOT NULL,
                              profit_margin_pct REAL NOT NULL,
                              best_supplier VARCHAR(255) NOT NULL,
                              generated_at DATETIME NOT NULL,
                              recipe_breakdown TEXT,
                              FOREIGN KEY(user_id) REFERENCES users (id)
                            )
                            """
                        )
                    )
                    conn.execute(text(f"INSERT INTO {mig} SELECT * FROM {tbl}"))
                    conn.execute(text(f"DROP TABLE {tbl}"))
                    conn.execute(text(f"ALTER TABLE {mig} RENAME TO {tbl}"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_monthly_snapshots_user_year_month "
                "ON monthly_financial_snapshots (user_id, year_month)"
            )
        )


_migrate_monthly_snapshots_allow_duplicates()


def _migrate_user_role_column() -> None:
    """Add users.role for cafe_owner vs local_supplier (SQLite + PostgreSQL)."""
    with engine.begin() as conn:
        dialect = conn.dialect.name
        if dialect == "postgresql":
            conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) "
                    "NOT NULL DEFAULT 'cafe_owner'"
                )
            )
        elif dialect == "sqlite":
            cols = conn.execute(text("PRAGMA table_info(users)")).fetchall()
            names = {row[1] for row in cols}
            if "role" not in names:
                conn.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN role VARCHAR(32) "
                        "NOT NULL DEFAULT 'cafe_owner'"
                    )
                )


_migrate_user_role_column()


def _migrate_local_store_product_image_url() -> None:
    """Add optional product image URL for local store listings."""
    with engine.begin() as conn:
        dialect = conn.dialect.name
        if dialect == "postgresql":
            conn.execute(
                text(
                    "ALTER TABLE local_store_products ADD COLUMN IF NOT EXISTS "
                    "image_url VARCHAR(2048) NOT NULL DEFAULT ''"
                )
            )
        elif dialect == "sqlite":
            cols = conn.execute(text("PRAGMA table_info(local_store_products)")).fetchall()
            names = {row[1] for row in cols}
            if "image_url" not in names:
                conn.execute(
                    text(
                        "ALTER TABLE local_store_products ADD COLUMN image_url "
                        "VARCHAR(2048) NOT NULL DEFAULT ''"
                    )
                )


_migrate_local_store_product_image_url()

def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "").strip()
    if not raw:
        # Vercel production + preview URLs vary; Bearer tokens are not cookies so * is safe.
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ingredient_out(obj: Ingredient) -> IngredientOut:
    return IngredientOut.model_validate(obj)


def _other_out(obj: OtherCost) -> OtherCostOut:
    return OtherCostOut.model_validate(obj)


def _store_out(store: LocalStore, product_count: int | None = None) -> LocalStoreOut:
    count = product_count
    if count is None:
        count = len(store.products) if store.products is not None else 0
    return LocalStoreOut(
        id=store.id,
        owner_user_id=store.owner_user_id,
        store_name=store.store_name,
        description=store.description,
        address=store.address,
        contact_number=store.contact_number,
        is_active=store.is_active,
        created_at=store.created_at,
        updated_at=store.updated_at,
        product_count=count,
    )


def _product_out(obj: LocalStoreProduct) -> LocalStoreProductOut:
    return LocalStoreProductOut.model_validate(obj)


def _supplier_store(db: Session, user: User) -> LocalStore:
    store = db.scalar(select(LocalStore).where(LocalStore.owner_user_id == user.id))
    if not store:
        raise HTTPException(status_code=404, detail="Supplier store not found")
    return store


@app.get("/")
def root():
    return {"message": "PriceWise recipe costing API is running"}


@app.get("/health")
def health():
    return {"status": "ok"}


class MarketplaceScrapeIn(BaseModel):
    url: str
    marketplace: Literal["shopee", "lazada"]


class MarketplaceScrapeOut(BaseModel):
    ok: bool
    body_json: str | None = None
    error: str | None = None


@app.post("/marketplace/scrape", response_model=MarketplaceScrapeOut)
async def marketplace_scrape(body: MarketplaceScrapeIn):
    """Fetch listing JSON via Playwright (Chromium). Requires `playwright install chromium`."""
    try:
        if body.marketplace == "shopee":
            ok, text, err = await asyncio.to_thread(scrape_shopee_sync, body.url)
        else:
            ok, text, err = await asyncio.to_thread(scrape_lazada_sync, body.url)
        if ok and text:
            return MarketplaceScrapeOut(ok=True, body_json=text, error=None)
        return MarketplaceScrapeOut(ok=False, body_json=None, error=err or "Scrape failed")
    except Exception as exc:
        # Always JSON — never plain-text/HTML 500 (frontend expects JSON)
        return MarketplaceScrapeOut(
            ok=False,
            body_json=None,
            error=f"{type(exc).__name__}: {exc}",
        )


@app.post("/auth/register", response_model=UserOut)
def register(payload: UserRegisterIn, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == payload.email.lower().strip()))
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=payload.email.lower().strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()
    if payload.role == "local_supplier":
        db.add(
            LocalStore(
                owner_user_id=user.id,
                store_name=payload.store_name.strip(),
                description=payload.store_description.strip(),
                address=payload.store_address.strip(),
                contact_number=payload.contact_number.strip(),
            )
        )
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=TokenOut)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == form_data.username.lower().strip()))
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(str(user.id))
    return TokenOut(access_token=token)


@app.post("/auth/google", response_model=TokenOut)
def auth_google(payload: GoogleAuthIn, db: Session = Depends(get_db)):
    email: Optional[str] = None

    if payload.credential:
        try:
            req_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={payload.credential}"
            req = urllib.request.Request(req_url, headers={"User-Agent": "PriceWise-Server"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                email = data.get("email")
                google_client_id = os.getenv("GOOGLE_CLIENT_ID")
                if google_client_id and data.get("aud") != google_client_id:
                    raise HTTPException(status_code=400, detail="Google token client ID mismatch")
        except urllib.error.HTTPError as exc:
            raise HTTPException(status_code=400, detail="Invalid Google token credential") from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Google authentication failed: {exc}") from exc
    elif payload.email:
        email = payload.email.lower().strip()
    else:
        raise HTTPException(status_code=400, detail="Google credential or email is required")

    if not email or not email.lower().endswith("@gmail.com"):
        raise HTTPException(status_code=400, detail="Only Gmail addresses (@gmail.com) are allowed")

    email = email.lower().strip()
    user = db.scalar(select(User).where(User.email == email))
    if not user:
        random_pwd = secrets.token_urlsafe(32)
        user = User(email=email, password_hash=hash_password(random_pwd), role="cafe_owner")
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token(str(user.id))
    return TokenOut(access_token=token)


@app.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


# --- Local store marketplace (public browse + supplier manage) ---


@app.get("/local-stores", response_model=list[LocalStoreOut])
def list_local_stores(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _ = current_user
    rows = db.scalars(
        select(LocalStore)
        .where(LocalStore.is_active.is_(True))
        .order_by(LocalStore.store_name.asc())
    ).all()
    out: list[LocalStoreOut] = []
    for store in rows:
        count = db.scalar(
            select(func.count(LocalStoreProduct.id)).where(
                LocalStoreProduct.store_id == store.id,
                LocalStoreProduct.is_available.is_(True),
            )
        )
        out.append(_store_out(store, int(count or 0)))
    return out


@app.get("/local-stores/{store_id}", response_model=LocalStoreDetailOut)
def get_local_store(
    store_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    store = db.scalar(select(LocalStore).where(LocalStore.id == store_id, LocalStore.is_active.is_(True)))
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    products = db.scalars(
        select(LocalStoreProduct)
        .where(LocalStoreProduct.store_id == store.id, LocalStoreProduct.is_available.is_(True))
        .order_by(LocalStoreProduct.name.asc())
    ).all()
    base = _store_out(store, len(products))
    return LocalStoreDetailOut(**base.model_dump(), products=[_product_out(p) for p in products])


@app.get("/supplier/store", response_model=LocalStoreDetailOut)
def get_supplier_store(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("local_supplier")),
):
    store = _supplier_store(db, current_user)
    products = db.scalars(
        select(LocalStoreProduct)
        .where(LocalStoreProduct.store_id == store.id)
        .order_by(LocalStoreProduct.updated_at.desc())
    ).all()
    base = _store_out(store, len(products))
    return LocalStoreDetailOut(**base.model_dump(), products=[_product_out(p) for p in products])


@app.put("/supplier/store", response_model=LocalStoreOut)
def update_supplier_store(
    payload: LocalStoreUpdateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("local_supplier")),
):
    store = _supplier_store(db, current_user)
    if payload.store_name is not None:
        store.store_name = payload.store_name.strip()
    if payload.description is not None:
        store.description = payload.description.strip()
    if payload.address is not None:
        store.address = payload.address.strip()
    if payload.contact_number is not None:
        store.contact_number = payload.contact_number.strip()
    if payload.is_active is not None:
        store.is_active = payload.is_active
    store.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(store)
    count = db.scalar(
        select(func.count(LocalStoreProduct.id)).where(LocalStoreProduct.store_id == store.id)
    )
    return _store_out(store, int(count or 0))


@app.post("/supplier/products", response_model=LocalStoreProductOut)
def create_supplier_product(
    payload: LocalStoreProductCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("local_supplier")),
):
    store = _supplier_store(db, current_user)
    now = datetime.utcnow()
    row = LocalStoreProduct(
        store_id=store.id,
        name=payload.name.strip(),
        category=payload.category,
        package_price=payload.package_price,
        shipping_fee=payload.shipping_fee,
        package_size=payload.package_size,
        package_unit=payload.package_unit,
        base_quantity=payload.base_quantity,
        base_unit=payload.base_unit,
        unit_cost=payload.unit_cost,
        notes=payload.notes.strip(),
        image_url=(payload.image_url or "").strip(),
        is_available=payload.is_available,
        updated_at=now,
    )
    db.add(row)
    store.updated_at = now
    db.commit()
    db.refresh(row)
    return _product_out(row)


@app.patch("/supplier/products/{product_id}", response_model=LocalStoreProductOut)
def update_supplier_product(
    product_id: int,
    payload: LocalStoreProductUpdateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("local_supplier")),
):
    store = _supplier_store(db, current_user)
    row = db.scalar(
        select(LocalStoreProduct).where(
            LocalStoreProduct.id == product_id,
            LocalStoreProduct.store_id == store.id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    data = payload.model_dump(exclude_unset=True)
    for key, val in data.items():
        if key == "name" and isinstance(val, str):
            setattr(row, key, val.strip())
        elif key == "notes" and isinstance(val, str):
            setattr(row, key, val.strip())
        else:
            setattr(row, key, val)
    row.updated_at = datetime.utcnow()
    store.updated_at = row.updated_at
    db.commit()
    db.refresh(row)
    return _product_out(row)


@app.delete("/supplier/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("local_supplier")),
):
    store = _supplier_store(db, current_user)
    row = db.scalar(
        select(LocalStoreProduct).where(
            LocalStoreProduct.id == product_id,
            LocalStoreProduct.store_id == store.id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(row)
    store.updated_at = datetime.utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.patch("/auth/me/password")
def change_password(
    payload: PasswordChangeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}


@app.get("/workspace")
def get_workspace(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.get(UserWorkspace, current_user.id)
    base = WorkspaceState().model_dump(mode="json", by_alias=True)
    if not row or not row.payload:
        return base
    merged = {**base, **(row.payload if isinstance(row.payload, dict) else {})}
    try:
        state = WorkspaceState.model_validate(merged)
    except Exception:
        state = WorkspaceState()
    return state.model_dump(mode="json", by_alias=True)


@app.put("/workspace")
def put_workspace(
    body: WorkspaceState,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = body.model_dump(mode="json", by_alias=True)
    now = datetime.utcnow()
    row = db.get(UserWorkspace, current_user.id)
    if row:
        row.payload = data
        row.updated_at = now
    else:
        row = UserWorkspace(user_id=current_user.id, payload=data, updated_at=now)
        db.add(row)
    db.commit()
    return data


@app.post("/ml/smart-pricing/analyze")
def post_smart_pricing_analyze(
    body: SmartPricingAnalyzeIn,
    current_user: User = Depends(get_current_user),
):
    """ML-style pricing and cost intelligence from catalog history + recipe rows (client-built payload)."""
    _ = current_user.id
    return analyze_smart_pricing(body)


@app.get("/monthly-summaries", response_model=list[MonthlySnapshotOut])
def list_monthly_summaries(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(MonthlyFinancialSnapshot)
        .where(MonthlyFinancialSnapshot.user_id == current_user.id)
        .order_by(
            MonthlyFinancialSnapshot.year_month.asc(),
            MonthlyFinancialSnapshot.generated_at.asc(),
        )
    ).all()
    return [MonthlySnapshotOut.model_validate(r) for r in rows]


@app.post("/monthly-summaries", response_model=MonthlySnapshotOut)
def create_monthly_summary(
    payload: MonthlySnapshotCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    breakdown_dump = None
    if payload.recipe_breakdown is not None:
        breakdown_dump = [x.model_dump() for x in payload.recipe_breakdown]

    now = datetime.utcnow()
    row = MonthlyFinancialSnapshot(
        user_id=current_user.id,
        year_month=payload.year_month,
        total_opex=payload.total_opex,
        total_revenue=payload.total_revenue,
        gross_profit=payload.gross_profit,
        net_profit=payload.net_profit,
        profit_margin_pct=payload.profit_margin_pct,
        best_supplier=payload.best_supplier.strip(),
        generated_at=now,
        recipe_breakdown=breakdown_dump,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return MonthlySnapshotOut.model_validate(row)


@app.delete("/monthly-summaries/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_monthly_summary(
    snapshot_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.scalar(
        select(MonthlyFinancialSnapshot).where(
            MonthlyFinancialSnapshot.id == snapshot_id,
            MonthlyFinancialSnapshot.user_id == current_user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/recipes", response_model=RecipeOut)
def create_recipe(
    payload: RecipeCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = Recipe(
        user_id=current_user.id, name=payload.name.strip(), description=payload.description.strip()
    )
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe


@app.get("/recipes", response_model=list[RecipeOut])
def list_recipes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return list(
        db.scalars(select(Recipe).where(Recipe.user_id == current_user.id).order_by(Recipe.created_at.desc()))
    )


@app.post("/ingredients", response_model=IngredientOut)
def create_ingredient(
    payload: IngredientCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    base_qty, base_unit = convert_to_base(payload.package_size, payload.package_unit)
    if base_qty <= 0:
        raise HTTPException(status_code=400, detail="package_size must be > 0")
    cpu = (payload.package_price + payload.shipping_fee) / base_qty
    row = Ingredient(
        user_id=current_user.id,
        name=payload.name.strip(),
        supplier=payload.supplier.strip(),
        package_price=payload.package_price,
        shipping_fee=payload.shipping_fee,
        package_size=payload.package_size,
        package_unit=payload.package_unit,
        base_quantity=base_qty,
        base_unit=base_unit,
        cost_per_unit=cpu,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _ingredient_out(row)


@app.get("/ingredients", response_model=list[IngredientOut])
def list_ingredients(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(select(Ingredient).where(Ingredient.user_id == current_user.id)).all()
    return [_ingredient_out(x) for x in rows]


@app.post("/recipes/{recipe_id}/ingredients", response_model=RecipeIngredientOut)
def add_recipe_ingredient(
    recipe_id: int,
    payload: RecipeIngredientCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = db.scalar(select(Recipe).where(Recipe.id == recipe_id, Recipe.user_id == current_user.id))
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    ing = db.scalar(
        select(Ingredient).where(Ingredient.id == payload.ingredient_id, Ingredient.user_id == current_user.id)
    )
    if not ing:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    if payload.quantity < 0:
        raise HTTPException(status_code=400, detail="Quantity must be >= 0")
    row = RecipeIngredient(recipe_id=recipe.id, ingredient_id=ing.id, quantity=payload.quantity)
    db.add(row)
    db.commit()
    db.refresh(row)
    return RecipeIngredientOut(
        id=row.id,
        ingredient_id=ing.id,
        ingredient_name=ing.name,
        quantity=row.quantity,
        unit=ing.base_unit,
        cost_per_unit=ing.cost_per_unit,
        line_cost=row.quantity * ing.cost_per_unit,
    )


@app.post("/opex", response_model=OpexOut)
def create_opex(
    payload: OpexCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = Opex(
        user_id=current_user.id, name=payload.name.strip(), amount=payload.amount, type=payload.type
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/opex", response_model=list[OpexOut])
def list_opex(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return list(db.scalars(select(Opex).where(Opex.user_id == current_user.id)))


@app.post("/other-costs", response_model=OtherCostOut)
def create_other_cost(
    payload: OtherCostCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    base_qty, base_unit = convert_to_base(payload.package_size, payload.package_unit)
    if base_qty <= 0:
        raise HTTPException(status_code=400, detail="package_size must be > 0")
    cpu = (payload.package_price + payload.shipping_fee) / base_qty
    row = OtherCost(
        user_id=current_user.id,
        name=payload.name.strip(),
        supplier=payload.supplier.strip(),
        package_price=payload.package_price,
        shipping_fee=payload.shipping_fee,
        package_size=payload.package_size,
        package_unit=payload.package_unit,
        base_quantity=base_qty,
        base_unit=base_unit,
        cost_per_unit=cpu,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _other_out(row)


@app.get("/other-costs", response_model=list[OtherCostOut])
def list_other_costs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(select(OtherCost).where(OtherCost.user_id == current_user.id)).all()
    return [_other_out(x) for x in rows]


@app.post("/recipes/{recipe_id}/other-costs", response_model=RecipeOtherCostOut)
def add_recipe_other_cost(
    recipe_id: int,
    payload: RecipeOtherCostCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recipe = db.scalar(select(Recipe).where(Recipe.id == recipe_id, Recipe.user_id == current_user.id))
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    other = db.scalar(
        select(OtherCost).where(OtherCost.id == payload.other_cost_id, OtherCost.user_id == current_user.id)
    )
    if not other:
        raise HTTPException(status_code=404, detail="Other cost not found")
    row = RecipeOtherCost(recipe_id=recipe.id, other_cost_id=other.id, quantity=payload.quantity)
    db.add(row)
    db.commit()
    db.refresh(row)
    return RecipeOtherCostOut(
        id=row.id,
        other_cost_id=other.id,
        other_cost_name=other.name,
        quantity=row.quantity,
        unit=other.base_unit,
        cost_per_unit=other.cost_per_unit,
        line_cost=row.quantity * other.cost_per_unit,
    )


@app.get("/recipes/{recipe_id}", response_model=RecipeDetailsOut)
def get_recipe_details(
    recipe_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    recipe = db.scalar(
        select(Recipe)
        .where(Recipe.id == recipe_id, Recipe.user_id == current_user.id)
        .options(
            joinedload(Recipe.recipe_ingredients).joinedload(RecipeIngredient.ingredient),
            joinedload(Recipe.recipe_other_costs).joinedload(RecipeOtherCost.other_cost),
        )
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    ingredient_items: list[RecipeIngredientOut] = []
    total_ingredient_cost = 0.0
    for link in recipe.recipe_ingredients:
        ing = link.ingredient
        line_cost = link.quantity * ing.cost_per_unit
        total_ingredient_cost += line_cost
        ingredient_items.append(
            RecipeIngredientOut(
                id=link.id,
                ingredient_id=ing.id,
                ingredient_name=ing.name,
                quantity=link.quantity,
                unit=ing.base_unit,
                cost_per_unit=ing.cost_per_unit,
                line_cost=line_cost,
            )
        )

    other_items: list[RecipeOtherCostOut] = []
    total_other_cost = 0.0
    for link in recipe.recipe_other_costs:
        oc = link.other_cost
        line_cost = link.quantity * oc.cost_per_unit
        total_other_cost += line_cost
        other_items.append(
            RecipeOtherCostOut(
                id=link.id,
                other_cost_id=oc.id,
                other_cost_name=oc.name,
                quantity=link.quantity,
                unit=oc.base_unit,
                cost_per_unit=oc.cost_per_unit,
                line_cost=line_cost,
            )
        )

    total_cogs = total_ingredient_cost + total_other_cost
    recipe_count = db.scalar(select(func.count(Recipe.id)).where(Recipe.user_id == current_user.id)) or 1
    total_opex = db.scalar(select(func.coalesce(func.sum(Opex.amount), 0)).where(Opex.user_id == current_user.id)) or 0
    allocated_opex = float(total_opex) / float(recipe_count)
    total_cost_per_recipe = total_cogs + allocated_opex
    margin_percent = 25.0
    suggested_price = total_cost_per_recipe * (1 + margin_percent / 100)

    return RecipeDetailsOut(
        id=recipe.id,
        name=recipe.name,
        description=recipe.description,
        created_at=recipe.created_at,
        ingredients=ingredient_items,
        other_costs=other_items,
        costing={
            "total_ingredient_cost": total_ingredient_cost,
            "total_other_cost": total_other_cost,
            "total_cogs": total_cogs,
            "allocated_opex": allocated_opex,
            "total_cost_per_recipe": total_cost_per_recipe,
            "suggested_price": suggested_price,
            "margin_percent": margin_percent,
        },
    )
