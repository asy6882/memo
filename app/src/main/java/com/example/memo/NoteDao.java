package com.example.memo;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

public class NoteDao {

    private SQLiteDatabase database;
    private NoteDatabaseHelper dbHelper;

    public NoteDao(Context context) {
        dbHelper = new NoteDatabaseHelper(context);
    }

    public void open() {
        database = dbHelper.getWritableDatabase();
    }

    public void close() {
        dbHelper.close();
    }

    public void saveNote(String date, String content) {
        ContentValues values = new ContentValues();
        values.put(NoteDatabaseHelper.COLUMN_DATE, date);
        values.put(NoteDatabaseHelper.COLUMN_CONTENT, content);

        String selection = NoteDatabaseHelper.COLUMN_DATE + " = ?";
        String[] selectionArgs = { date };

        int count = database.update(NoteDatabaseHelper.TABLE_NOTES, values, selection, selectionArgs);
        if (count == 0) {
            database.insert(NoteDatabaseHelper.TABLE_NOTES, null, values);
        }
    }

    public String getNoteByDate(String date) {
        String[] columns = {
                NoteDatabaseHelper.COLUMN_CONTENT
        };
        String selection = NoteDatabaseHelper.COLUMN_DATE + " = ?";
        String[] selectionArgs = { date };

        Cursor cursor = database.query(NoteDatabaseHelper.TABLE_NOTES, columns, selection, selectionArgs,
                null, null, null);

        String content = null;
        if (cursor != null) {
            if (cursor.moveToFirst()) {
                content = cursor.getString(cursor.getColumnIndexOrThrow(NoteDatabaseHelper.COLUMN_CONTENT));
            }
            cursor.close();
        }
        return content;
    }
}
