import re
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PACKAGE_UNITS = {"kg", "g", "L", "ml", "piece"}
BASE_UNITS = {"g", "ml", "piece"}


def convert_to_base(package_size: float, package_unit: str) -> tuple[float, str]:
    if package_unit == "kg":
        return package_size * 1000, "g"
    if package_unit == "g":
        return package_size, "g"
    if package_unit == "L":
        return package_size * 1000, "ml"
    if package_unit == "ml":
        return package_size, "ml"
    if package_unit == "piece":
        return package_size, "piece"
    raise ValueError("Invalid package unit")


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class GoogleAuthIn(BaseModel):
    credential: Optional[str] = None
    email: Optional[str] = None


class UserRegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=6)
    role: Literal["cafe_owner", "local_supplier"] = "cafe_owner"
    store_name: str = ""
    store_description: str = ""
    store_address: str = ""
    contact_number: str = ""

    @field_validator("email")
    @classmethod
    def validate_gmail(cls, v: str) -> str:
        if not v.lower().strip().endswith("@gmail.com"):
            raise ValueError("Only Gmail addresses are allowed")
        return v.lower().strip()

    @model_validator(mode="after")
    def validate_supplier_store(self) -> "UserRegisterIn":
        if self.role == "local_supplier" and len(self.store_name.strip()) < 2:
            raise ValueError("Store name is required for local supplier accounts")
        return self


class UserOut(BaseModel):
    id: int
    email: str
    role: str = "cafe_owner"
    created_at: datetime

    model_config = {"from_attributes": True}


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class RecipeCreateIn(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class RecipeOut(BaseModel):
    id: int
    name: str
    description: str
    created_at: datetime

    model_config = {"from_attributes": True}


class IngredientBaseIn(BaseModel):
    name: str = Field(min_length=1)
    supplier: str = ""
    package_price: float = Field(gt=0)
    shipping_fee: float = Field(ge=0, default=0)
    package_size: float = Field(gt=0)
    package_unit: str

    @field_validator("package_unit")
    @classmethod
    def validate_unit(cls, v: str) -> str:
        if v not in PACKAGE_UNITS:
            raise ValueError(f"package_unit must be one of: {sorted(PACKAGE_UNITS)}")
        return v


class IngredientCreateIn(IngredientBaseIn):
    pass


class IngredientOut(BaseModel):
    id: int
    name: str
    supplier: str
    package_price: float
    shipping_fee: float
    package_size: float
    package_unit: str
    base_quantity: float
    base_unit: str
    cost_per_unit: float
    created_at: datetime

    model_config = {"from_attributes": True}


class RecipeIngredientCreateIn(BaseModel):
    ingredient_id: int
    quantity: float = Field(gt=0)


class RecipeIngredientOut(BaseModel):
    id: int
    ingredient_id: int
    ingredient_name: str
    quantity: float
    unit: str
    cost_per_unit: float
    line_cost: float


class OpexCreateIn(BaseModel):
    name: str = Field(min_length=1)
    amount: float = Field(ge=0)
    type: Literal["fixed", "variable"]


class OpexOut(BaseModel):
    id: int
    name: str
    amount: float
    type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class OtherCostCreateIn(IngredientBaseIn):
    pass


class OtherCostOut(BaseModel):
    id: int
    name: str
    supplier: str
    package_price: float
    shipping_fee: float
    package_size: float
    package_unit: str
    base_quantity: float
    base_unit: str
    cost_per_unit: float
    created_at: datetime

    model_config = {"from_attributes": True}


class RecipeOtherCostCreateIn(BaseModel):
    other_cost_id: int
    quantity: float = Field(gt=0)


class RecipeOtherCostOut(BaseModel):
    id: int
    other_cost_id: int
    other_cost_name: str
    quantity: float
    unit: str
    cost_per_unit: float
    line_cost: float


class RecipeCostSummaryOut(BaseModel):
    total_ingredient_cost: float
    total_other_cost: float
    total_cogs: float
    allocated_opex: float
    total_cost_per_recipe: float
    suggested_price: float
    margin_percent: float


class RecipeDetailsOut(BaseModel):
    id: int
    name: str
    description: str
    created_at: datetime
    ingredients: list[RecipeIngredientOut]
    other_costs: list[RecipeOtherCostOut]
    costing: RecipeCostSummaryOut


_YEAR_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class RecipeSalesSnapshotEntryIn(BaseModel):
    recipe_id: str = Field(min_length=1)
    recipe_name: str = Field(min_length=1)
    orders: float = Field(ge=0)
    revenue: float
    profit: float


class RecipeSalesSnapshotEntryOut(BaseModel):
    recipe_id: str
    recipe_name: str
    orders: float
    revenue: float
    profit: float


class MonthlySnapshotCreateIn(BaseModel):
    year_month: str = Field(min_length=7, max_length=7)
    total_opex: float = Field(ge=0)
    total_revenue: float = Field(ge=0)
    gross_profit: float
    net_profit: float
    profit_margin_pct: float
    best_supplier: str = ""
    recipe_breakdown: list[RecipeSalesSnapshotEntryIn] | None = None

    @field_validator("year_month")
    @classmethod
    def validate_year_month(cls, v: str) -> str:
        if not _YEAR_MONTH.match(v.strip()):
            raise ValueError("year_month must be YYYY-MM")
        return v.strip()


class MonthlySnapshotOut(BaseModel):
    id: int
    year_month: str
    total_opex: float
    total_revenue: float
    gross_profit: float
    net_profit: float
    profit_margin_pct: float
    best_supplier: str
    generated_at: datetime
    recipe_breakdown: list[RecipeSalesSnapshotEntryOut] | None = None

    model_config = {"from_attributes": True}


class WorkspaceState(BaseModel):
    """Opaque JSON workspace synced from the Svelte client (camelCase keys in JSON)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    recipes: list[Any] = Field(default_factory=list)
    ingredients: list[Any] = Field(default_factory=list)
    others: list[Any] = Field(default_factory=list)
    opex: list[Any] = Field(default_factory=list)
    summary_sales: dict[str, float] = Field(
        default_factory=dict, serialization_alias="summarySales", validation_alias="summarySales"
    )
    costing_settings: dict[str, Any] = Field(
        default_factory=dict, serialization_alias="costingSettings", validation_alias="costingSettings"
    )
    sales_transactions: list[Any] = Field(
        default_factory=list, serialization_alias="salesTransactions", validation_alias="salesTransactions"
    )


# --- Local store marketplace ---


class LocalStoreProductCreateIn(BaseModel):
    name: str = Field(min_length=1)
    category: Literal["ingredient", "other"] = "ingredient"
    package_price: float = Field(gt=0)
    shipping_fee: float = Field(ge=0, default=0)
    package_size: float = Field(gt=0)
    package_unit: str = Field(min_length=1)
    base_quantity: float = Field(gt=0)
    base_unit: Literal["g", "ml", "piece"]
    unit_cost: float = Field(gt=0)
    notes: str = ""
    image_url: str = ""
    is_available: bool = True


class LocalStoreProductUpdateIn(BaseModel):
    name: str | None = None
    category: Literal["ingredient", "other"] | None = None
    package_price: float | None = Field(default=None, gt=0)
    shipping_fee: float | None = Field(default=None, ge=0)
    package_size: float | None = Field(default=None, gt=0)
    package_unit: str | None = None
    base_quantity: float | None = Field(default=None, gt=0)
    base_unit: Literal["g", "ml", "piece"] | None = None
    unit_cost: float | None = Field(default=None, gt=0)
    notes: str | None = None
    image_url: str | None = None
    is_available: bool | None = None


class LocalStoreProductOut(BaseModel):
    id: int
    store_id: int
    name: str
    category: str
    package_price: float
    shipping_fee: float
    package_size: float
    package_unit: str
    base_quantity: float
    base_unit: str
    unit_cost: float
    notes: str
    image_url: str
    is_available: bool
    updated_at: datetime

    model_config = {"from_attributes": True}


class LocalStoreOut(BaseModel):
    id: int
    owner_user_id: int
    store_name: str
    description: str
    address: str
    contact_number: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    product_count: int = 0

    model_config = {"from_attributes": True}


class LocalStoreDetailOut(LocalStoreOut):
    products: list[LocalStoreProductOut] = Field(default_factory=list)


class LocalStoreUpdateIn(BaseModel):
    store_name: str | None = Field(default=None, min_length=2)
    description: str | None = None
    address: str | None = None
    contact_number: str | None = None
    is_active: bool | None = None


# --- Smart Pricing ML API (client sends precomputed COGS + list prices) ---


class UnitCostHistoryIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    recorded_at: str = Field(validation_alias="recordedAt")
    unit_cost: float = Field(validation_alias="unitCost")


class CatalogItemMLIn(BaseModel):
    """Ingredient or Other master row for ML (matches workspace JSON shape)."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    name: str
    unit_cost: float = Field(validation_alias="unitCost")
    supplier: str = ""
    unit_cost_history: list[UnitCostHistoryIn] = Field(default_factory=list, validation_alias="unitCostHistory")


class RecipePricingMLIn(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    name: str
    cogs: float
    current_local: float = Field(validation_alias="currentLocal")
    suggested_local: float = Field(validation_alias="suggestedLocal")
    current_shopee: float = Field(default=0, validation_alias="currentShopee")
    current_lazada: float = Field(default=0, validation_alias="currentLazada")
    ingredient_cogs: float = Field(default=0, validation_alias="ingredientCogs")
    packaging_cogs: float = Field(default=0, validation_alias="packagingCogs")


class HistoricalSnapshotMLIn(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    year_month: str = Field(validation_alias="yearMonth")
    total_revenue: float = Field(default=0, validation_alias="totalRevenue")
    gross_profit: float = Field(default=0, validation_alias="grossProfit")
    total_opex: float = Field(default=0, validation_alias="totalOpex")
    net_profit: float = Field(default=0, validation_alias="netProfit")


class ActualSaleMLIn(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    recipe_id: str = Field(validation_alias="recipeId")
    recipe_name: str = Field(default="", validation_alias="recipeName")
    quantity: int = 1
    total_amount: float = Field(default=0, validation_alias="totalAmount")
    profit: float = 0
    sold_at: str = Field(default="", validation_alias="soldAt")


class SmartPricingAnalyzeIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ingredients: list[CatalogItemMLIn] = Field(default_factory=list)
    others: list[CatalogItemMLIn] = Field(default_factory=list)
    recipes: list[RecipePricingMLIn] = Field(default_factory=list)
    summary_sales: dict[str, float] = Field(default_factory=dict, validation_alias="summarySales")
    target_margin_pct: float = Field(default=70, validation_alias="targetMarginPct")
    historical_snapshots: list[HistoricalSnapshotMLIn] = Field(
        default_factory=list, validation_alias="historicalSnapshots"
    )
    actual_sales: list[ActualSaleMLIn] = Field(default_factory=list, validation_alias="actualSales")
    monthly_opex: float = Field(default=0, validation_alias="monthlyOpex")

