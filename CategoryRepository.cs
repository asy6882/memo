using Dapper;
using navi.DTO;
using Npgsql;

namespace navi.Repositories
{
    public class CategoryRepository
    {
        private readonly string _cs;
        public CategoryRepository(IConfiguration cfg) => _cs = cfg.GetConnectionString("DefaultConnection");


        //Search
        public async Task<IEnumerable<CategoryDto>> SearchAsync(string? q)
        {
            const string sql = @"
SELECT category_id, category_name
FROM category
WHERE (@q IS NULL OR category_name ILIKE (@q || '%'))
ORDER BY category_name;";

            await using var conn = new NpgsqlConnection(_cs);
            return await conn.QueryAsync<CategoryDto>(sql, new { q });

        }


        public async Task<CategoryDto> CreateAsync(string name)
        {
            const string ins = @"
INSERT INTO category (category_name)
VALUES (@name)
ON CONFLICT (category_name) DO NOTHING
RETURNING category_id, category_name;";

            await using var conn = new NpgsqlConnection(_cs);
            var created = await conn.QuerySingleOrDefaultAsync<CategoryDto>(ins, new { name });
            if (created != null) return created;

            const string sel = @"SELECT category_id, category_name FROM categories WHERE category_name=@name;";
            return await conn.QuerySingleAsync<CategoryDto>(sel, new { name });
        }

        public async Task<int> GetOrCreateCategoryIdAsync(string name)
        {
            const string sql = @"
WITH ins AS(
 INSERT INTO category (category_name)
 VALUES (@Name)
 ON CONFLICT (category_name) DO NOTHING
 RETURNING category_id
)
SELECT category_id FROM ins
UNION ALL 
SELECT category_id FROM category WHERE category_name = @Name
LIMIT 1;";
            await using var conn = new NpgsqlConnection(_cs);
            return await conn.ExecuteScalarAsync<int>(sql, new { Name = name.Trim() });
        }



    }
}
