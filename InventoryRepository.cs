using Dapper;
using navi.DTO;
using navi.Models;
using Npgsql;

namespace navi.Repositories
{

    public class InventoryRepository
    {
        private readonly string _cs;
        public InventoryRepository(IConfiguration cfg) => _cs = cfg.GetConnectionString("DefaultConnection");

        public async Task<IEnumerable<Asset>> ListAssetsByFloorAsync(int floorId)
        {
            const string sql = @"
SELECT asset_code, asset_name
FROM asset a
JOIN zones z ON a.location_code = z.location_code
WHERE z.floor_id = @floorId
ORDER BY asset_code;";
            await using var conn = new NpgsqlConnection(_cs);
            return await conn.QueryAsync<Asset>(sql, new { floorId });
        }

        // 구역별 자산
        public async Task<IEnumerable<Asset>> ListAssetsByZoneAsync(int floorId, int zoneId)
        {
            const string sql = @"
SELECT asset_code, asset_name
FROM asset a
JOIN zones z ON a.location_code = z.location_code
WHERE z.floor_id = @floorId
  AND z.zone_id = @zoneId
ORDER BY asset_code;";
            await using var conn = new NpgsqlConnection(_cs);
            return await conn.QueryAsync<Asset>(sql, new { floorId, zoneId });
        }



        // ===========================================
        public async Task<IEnumerable<AssetDto>> SearchAssetAsync(
                int? buildingId,
                int? floorId,
                int? zoneId,
                long? locationCode,
                int? categoryId,
                int? itemId,
                string? productCode,
                string? productName)
        {
            const string sql = @"
SELECT 
    a.asset_code    AS Asset_Code,
    c.category_name AS Category_Name,
    a.asset_name    AS Asset_Name,
    i.item_name     AS Item_Name,
    b.building_name AS Building,
    f.floor_label   AS Floor,
    z.zone_name     AS Area,
    COALESCE(NULLIF(a.location_name, ''), NULLIF(z.location_name, ''), '') AS Location_Name,
    a.purchase_price AS Purchase_Price,
    a.manufacturer   AS Manufacture,
    a.quantity       AS Quantity
FROM asset a
LEFT JOIN category c  ON c.category_id  = a.category_id
LEFT JOIN item i      ON i.item_id      = a.item_id
LEFT JOIN zones     z ON z.location_code = a.location_code
LEFT JOIN floors f    ON f.floor_id     = z.floor_id
LEFT JOIN buildings b ON b.building_id  = z.building_id
WHERE 1=1
    AND (@buildingId IS NULL OR b.building_id = @buildingId)
    AND (@floorId IS NULL OR f.floor_id = @floorId)
    AND (@zoneId IS NULL OR z.zone_id = @zoneId)
    AND (@locationCode IS NULL OR a.location_code = @locationCode)
    AND (@categoryId IS NULL OR c.category_id = @categoryId)
    AND (@itemId IS NULL OR i.item_id = @itemId)
    AND (@productCode IS NULL OR a.asset_code ILIKE (@productCode || '%'))
    AND (@productName IS NULL OR a.asset_name ILIKE (@productName || '%'))
ORDER BY a.asset_code ASC;";

            await using var conn = new NpgsqlConnection(_cs);
            return await conn.QueryAsync<AssetDto>(sql, new
            {
                buildingId,
                floorId,
                zoneId,
                locationCode,
                categoryId,
                itemId,
                productCode,
                productName
            });
        }
    }
}
