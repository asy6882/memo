package com.example.memo;

import androidx.appcompat.app.AppCompatActivity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.Toast;

import java.util.Locale;
import java.util.Calendar;

public class MainActivity extends AppCompatActivity {

    private NoteDao noteDao;
    private EditText editTextNote;
    private DatePicker datePicker;
    private Button buttonSave;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        noteDao = new NoteDao(this);
        noteDao.open();

        datePicker = findViewById(R.id.datePicker);
        editTextNote = findViewById(R.id.editTextNote);
        buttonSave = findViewById(R.id.buttonSave);

        datePicker.setOnDateChangedListener((view, year, monthOfYear, dayOfMonth) ->
                loadNoteForSelectedDate(year, monthOfYear, dayOfMonth)
        );

        buttonSave.setOnClickListener(v -> saveNote());

        Calendar calendar = Calendar.getInstance();
        loadNoteForSelectedDate(calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH));
    }

    @Override
    protected void onDestroy() {
        noteDao.close();
        super.onDestroy();
    }

    private void loadNoteForSelectedDate(int year, int month, int day) {
        String date = String.format(Locale.getDefault(), "%04d-%02d-%02d", year, month + 1, day);
        String content = noteDao.getNoteByDate(date);
        editTextNote.setText(content != null ? content : "");
    }

    private void saveNote() {
        String date = String.format(Locale.getDefault(), "%04d-%02d-%02d", datePicker.getYear(), datePicker.getMonth() + 1, datePicker.getDayOfMonth());
        String content = editTextNote.getText().toString();
        noteDao.saveNote(date, content);
        Toast.makeText(MainActivity.this, "Note saved", Toast.LENGTH_SHORT).show();
    }
}
