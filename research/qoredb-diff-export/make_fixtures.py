import json, sqlite3
from pathlib import Path
# Independently authored synthetic SQL. SQLite supplies the column labels and rows.
# Type/nullability/timing are fixed interface metadata; this is a source-module check.
c = sqlite3.connect(':memory:')
def query(sql):
    cur = c.execute(sql)
    names = [col[0] for col in cur.description]
    return {'columns': [{'name':n,'data_type':'text','nullable':False} for n in names],
            'rows':[{'values':list(row)} for row in cur.fetchall()], 'execution_time_ms':0}
fixtures={
    'ordinary': {'left': query("SELECT 1 AS id, 'paid' AS status"),
                 'right':query("SELECT 1 AS id, 'unpaid' AS status")},
    'status_name': {'left': query("SELECT 1 AS id, 'paid' AS _status"),
                    'right':query("SELECT 1 AS id, 'unpaid' AS _status")},
    'key_name': {'left': query("SELECT 1 AS id, 'customer-A' AS _key"),
                 'right':query("SELECT 1 AS id, 'customer-A' AS _key")},
}
assert [x['name'] for x in fixtures['status_name']['left']['columns']] == ['id','_status']
assert fixtures['ordinary']['left']['rows'][0]['values'] == [1,'paid']
Path(__file__).with_name('fixtures.json').write_text(json.dumps({'sqlite':sqlite3.sqlite_version,'fixtures':fixtures},indent=2))
print('SQLite',sqlite3.sqlite_version,'3 synthetic query pairs captured')
