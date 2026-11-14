package com.tharinduathapaththu.pubba.sample

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.tharinduathapaththu.pubba.Chip
import com.tharinduathapaththu.pubba.Entity
import com.tharinduathapaththu.pubba.EntityChip
import com.tharinduathapaththu.pubba.Guide
import com.tharinduathapaththu.pubba.Pubba
import com.tharinduathapaththu.pubba.QuestionChip
import com.tharinduathapaththu.pubba.Reply
import com.tharinduathapaththu.pubba.Trail
import com.tharinduathapaththu.pubba.TrailStorage
import com.tharinduathapaththu.pubba.createGuide
import kotlinx.coroutines.delay

/** The trail survives restarts in SharedPreferences. It stays on the device. */
private class PrefsStorage(context: Context) : TrailStorage {
    private val prefs = context.getSharedPreferences("pubba", Context.MODE_PRIVATE)
    override fun getItem(key: String): String? = prefs.getString(key, null)
    override fun setItem(key: String, value: String) = prefs.edit().putString(key, value).apply()
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Compiled with `npx pubba compile pubba.json --out app/src/main/assets/pubba.bundle.json`.
        val pubba = Pubba.load(assets.open("pubba.bundle.json").bufferedReader().use { it.readText() })
        val guide = createGuide(pubba) {
            trail = Trail(storage = PrefsStorage(this@MainActivity))
            route = { "item/${it.id}" }
            accept = { it.type != "person" }
        }
        setContent { MaterialTheme { App(pubba, guide) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun App(pubba: Pubba, guide: Guide) {
    val stack = remember { mutableStateListOf<String>() }
    val current = stack.lastOrNull()?.let { pubba.graph.find(it) }
    var guideOpen by remember { mutableStateOf(false) }
    var nudge by remember { mutableStateOf<Reply?>(null) }

    fun go(id: String, via: String?) {
        if (via == null) guide.visited(id) else guide.follow(id, via)
        stack.add(id)
    }

    BackHandler(enabled = stack.isNotEmpty()) { stack.removeAt(stack.lastIndex) }

    // A nudge only after a step the visitor took themselves; the guide decides if one is due.
    LaunchedEffect(current?.id) {
        nudge = null
        if (current == null) return@LaunchedEffect
        delay(guide.nudgePolicy.delayMs.toLong())
        nudge = guide.nudge()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(current?.label ?: "Nimali's work") },
                navigationIcon = {
                    if (stack.isNotEmpty()) TextButton(onClick = { stack.removeAt(stack.lastIndex) }) { Text("Back") }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { guideOpen = true; guide.opened() },
                modifier = Modifier.semantics { contentDescription = "Open the guide" },
            ) { Text("Ask") }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            nudge?.let { n ->
                NudgeCard(n, onOpen = { id -> nudge = null; go(id, "suggestion") }, onDismiss = { nudge = null })
            }
            if (current == null) Home(pubba) { go(it, null) } else ItemPage(pubba, current) { go(it, "related") }
        }
    }

    if (guideOpen) {
        GuideSheet(guide, onDismiss = { guideOpen = false }, onGo = { id, via -> guideOpen = false; go(id, via) })
    }
}

@Composable
private fun Home(pubba: Pubba, onOpen: (String) -> Unit) {
    val projects = pubba.graph.entities.values.filter { it.type == "project" }
    LazyColumn(Modifier.fillMaxSize()) {
        items(projects, key = { it.id }) { e -> EntityRow(e.label, e.type, onClick = { onOpen(e.id) }) }
    }
}

@Composable
private fun ItemPage(pubba: Pubba, e: Entity, onOpen: (String) -> Unit) {
    val related = remember(e.id) { pubba.related(e.id, limit = 8) }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Column(Modifier.padding(16.dp)) {
                Text(e.type.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge)
                e.text?.let { Text(it, Modifier.padding(top = 8.dp)) }
                Text("Related", Modifier.padding(top = 16.dp).semantics { heading() }, style = MaterialTheme.typography.titleMedium)
            }
        }
        items(related, key = { it.entity.id }) { r -> EntityRow(r.entity.label, r.text, onClick = { onOpen(r.entity.id) }) }
    }
}

@Composable
private fun EntityRow(title: String, subtitle: String, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        Text(subtitle, style = MaterialTheme.typography.bodySmall)
    }
    HorizontalDivider()
}

@Composable
private fun NudgeCard(n: Reply, onOpen: (String) -> Unit, onDismiss: () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(12.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
        Column(Modifier.padding(12.dp)) {
            Text(n.text)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Not now") }
                n.action?.let { a -> TextButton(onClick = { onOpen(a.id) }) { Text("Show me") } }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun GuideSheet(guide: Guide, onDismiss: () -> Unit, onGo: (String, String) -> Unit) {
    var question by remember { mutableStateOf("") }
    var reply by remember { mutableStateOf(guide.ask("")) }

    fun ask(text: String) {
        val r = guide.ask(text)
        reply = r
        // The guide doesn't move the visitor; the app performs the action.
        r.action?.let { onGo(it.id, "typed") }
    }

    fun tap(c: Chip) = when (c) {
        is EntityChip -> onGo(c.id, "chip")
        is QuestionChip -> ask(c.question)
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(16.dp).imePadding()) {
            Text(reply.text, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.bodyLarge)
            FlowRow(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                reply.chips.forEach { c -> AssistChip(onClick = { tap(c) }, label = { Text(c.label) }) }
            }
            Box(contentAlignment = Alignment.CenterEnd) {
                OutlinedTextField(
                    value = question,
                    onValueChange = { question = it },
                    label = { Text("Ask about the work") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { ask(question); question = "" }),
                )
            }
        }
    }
}
