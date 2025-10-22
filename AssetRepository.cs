using navi.Models;
using Npgsql;
using Dapper;
using System.Collections.Generic;
using System.Drawing;
using navi.DTO;


namespace navi.Repositories
{
    public class AssetRepository
    {
        private readonly string _cs;
        public AssetRepository(IConfiguration cfg) => _cs = cfg.GetConnectionString("DefaultConnection");


        public async Task<int> InsertAsync(Asset a)
        {
            const string sql = @"
INSERT INTO asset
( asset_code, asset_name, item_id, spec, category_id, manufacturer, quantity,
  purchase_date, purchase_price, other_fee, residual_value, useful_life,
  depreciation_rate, location_code, admin_id, create_date, update_date, location_name )
VALUES
( @Asset_Code, @Asset_Name, @Item_Id, @Spec, @Category_Id, @Manufacture, @Quantity,
  @Purchase_Date, @Purchase_Price, @Other_Fee, @Residual_Value, @Useful_Life,
  @Depreciation_Rate, @Location_Code, @Admin_Id, NOW(), NOW(), @Location_Name )
RETURNING asset_id;";

            using var conn = new NpgsqlConnection(_cs);
            return await conn.ExecuteScalarAsync<int>(sql, a);
        }


        public async Task<int> UpdateAsync(Asset a)
        {
            const string sql = @"
UPDATE asset SET
  asset_code        = @Asset_Code,
  asset_name        = @Asset_Name,
  item_id           = @Item_Id,
  spec              = @Spec,
  category_id       = @Category_Id,
  manufacturer      = @Manufacture,
  quantity          = @Quantity,
  purchase_date     = @Purchase_Date,
  purchase_price    = @Purchase_Price,
  other_fee         = @Other_Fee,
  residual_value    = @Residual_Value,
  useful_life       = @Useful_Life,
  depreciation_rate = @Depreciation_Rate,
  location_code     = @Location_Code,
  location_name     = @Location_Name,
  admin_id          = COALESCE(NULLIF(@Admin_Id,''), admin_id),
  update_date       = NOW()
WHERE asset_id = @Asset_Id;
";
            await using var conn = new NpgsqlConnection(_cs);
            var rows = await conn.ExecuteAsync(sql, a);
            Console.WriteLine($"[UpdateAsync] Asset_Id={a.Asset_id}, rows={rows}");
            return rows;
        }

        public async Task<int> DeleteAsync(int assetId)
        {
            const string sql = @"DELETE FROM asset WHERE asset_id = @Asset_Id;";
            await using var conn = new NpgsqlConnection(_cs);
            return await conn.ExecuteAsync(sql, new { Asset_Id = assetId });
        }



        public async Task<IReadOnlyList<string>> GetCodesByPrefixAsync(string prefix, int limit)
        {
            limit = Math.Clamp(limit, 1, 50);
            if (string.IsNullOrWhiteSpace(prefix)) return Array.Empty<string>();

            const string sql = @"
SELECT asset_code
FROM asset
WHERE asset_code ILIKE @p || '%'
ORDER BY asset_code
LIMIT @limit;";

            await using var conn = new NpgsqlConnection(_cs);
            var rows = await conn.QueryAsync<string>(sql, new { p = prefix, limit });
            return rows.AsList();


        }

        public async Task<AssetDto?> FindByCodeAsync(string code)
        {
            const string sql = @"
SELECT
  a.asset_id,
  a.asset_code            AS Asset_Code,
  a.asset_name            AS Asset_Name,
  a.item_id               AS Item_Id,
  i.item_name             AS Item_Name,
  a.spec                  AS Spec,
  a.category_id           AS Category_Id,
  c.category_name         AS Category_Name,
  a.manufacturer          AS Manufacture,
  a.quantity              AS Quantity,
  a.purchase_date         AS Purchase_Date,
  a.purchase_price        AS Purchase_Price,
  a.other_fee             AS Other_Fee,
  a.residual_value        AS Residual_Value,
  a.useful_life           AS Useful_Life,
  a.depreciation_rate     AS Depreciation_Rate,
  a.location_code         AS Location_Code,
  a.location_name         AS Location_Name,
  b.building_name         AS Building,
  f.floor_label           AS Floor,
  z.zone_name             AS Area,
  a.admin_id              AS Admin_Id,
  a.create_date           AS Create_Date,
  a.update_date           AS Update_Date
FROM asset a
LEFT JOIN category c ON c.category_id = a.category_id
LEFT JOIN item i ON i.item_id = a.item_id
LEFT JOIN zones z ON z.location_code = a.location_code
LEFT JOIN buildings b ON b.building_id = z.building_id
LEFT JOIN floors f ON f.floor_id = z.floor_id
WHERE TRIM(a.asset_code) ILIKE TRIM(@code)
LIMIT 1;";
            await using var conn = new NpgsqlConnection(_cs);
            return await conn.QueryFirstOrDefaultAsync<AssetDto>(sql, new { code });
        }


        //public async Task<Asset?> GetByIdAsync(string id)
        //{

        //}



        //==============================================================
        //CSV

        public async Task<int> BulkInsertAsync(IEnumerable<Asset> items)
        {
            const string sql = @"
INSERT INTO asset
( asset_code, asset_name, item_id, spec, category_id, manufacturer, quantity,
  purchase_date, purchase_price, other_fee, residual_value, useful_life,
  depreciation_rate, location_code, create_date, update_date, location_name )
VALUES
( @Asset_Code, @Asset_Name, @Item_Id, @Spec, @Category_Id, @Manufacture, @Quantity,
  @Purchase_Date, @Purchase_Price, @Other_Fee, @Residual_Value, @Useful_Life,
  @Depreciation_Rate, @Location_Code, NOW(), NOW(), @Location_Name );
";

            await using var conn = new NpgsqlConnection(_cs);
            await conn.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            try
            {
                var affected = 0;
                foreach (var a in items)
                {
                    affected += await conn.ExecuteAsync(sql, a, tx);
                }
                await tx.CommitAsync();
                return affected;
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync();
                Console.WriteLine("[BulkInsertAsync ERROR] " + ex.Message);
                throw;
            }
        }
    }
}
