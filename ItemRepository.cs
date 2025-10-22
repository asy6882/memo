using System.Data.SqlTypes;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace navi.Repositories
{
    public class ItemRepository
    {
        private readonly string _cs;
        public ItemRepository(IConfiguration cfg) => _cs = cfg.GetConnectionString("DefaultConnection");


        public async Task<IEnumerable<object>> SearchAsync(string? q, int categoryId)
        {
            const string sql = @"
SELECT item_id, item_name
FROM item
WHERE category_id = @categoryId
  AND (@q IS NULL OR item_name ILIKE (@q || '%'))
ORDER BY item_id DESC";

            await using var conn = new NpgsqlConnection(_cs);
            return await conn.QueryAsync(sql, new
            {
                q = string.IsNullOrWhiteSpace(q) ? null : q,
                categoryId
            });
        }



        public async Task<object> CreateAsync(string name, int categoryId)
        {
            const string sql = @"
INSERT INTO item (category_id, item_name)
VALUES (@categoryId, @name)
RETURNING item_id, item_name";
            await using var conn = new NpgsqlConnection(_cs);
            return await conn.QuerySingleAsync(sql, new {categoryId, name});

            
        }


        public async Task<int> GetOrCreateItemIdAsync(int categoryId, string name)
        {
            const string sql = @"
WITH ins AS(
 INSERT INTO item (category_id, item_name)
 VALUES (@CategoryId, @Name)
 ON CONFLICT (category_id, item_name) DO NOTHING
 RETURNING item_id
)
SELECT item_id FROM ins
UNION ALL
SELECT item_id FROM item WHERE category_id = @CategoryId AND item_name = @Name
LIMIT 1;";
            await using var conn = new NpgsqlConnection(_cs);
            return await conn.ExecuteScalarAsync<int>(sql, new { CategoryId = categoryId, Name = name.Trim() });
        }


    }
}
