-- AUTO GENERATED FILE! DO NOT EDIT!

---@type QuestieDB
local QuestieDB = QuestieLoader:ImportModule("QuestieDB");

QuestieDB.questKeys = {
    ['name'] = 1, -- string
    ['startedBy'] = 2, -- table
        --['creatureStart'] = 1, -- table {creature(int),...}
        --['objectStart'] = 2, -- table {object(int),...}
        --['itemStart'] = 3, -- table {item(int),...}
    ['finishedBy'] = 3, -- table
        --['creatureEnd'] = 1, -- table {creature(int),...}
        --['objectEnd'] = 2, -- table {object(int),...}
    ['requiredLevel'] = 4, -- int
    ['questLevel'] = 5, -- int
    ['requiredRaces'] = 6, -- bitmask
    ['requiredClasses'] = 7, -- bitmask
    ['objectivesText'] = 8, -- table: {string,...}, Description of the quest. Auto-complete if nil.
    ['triggerEnd'] = 9, -- table: {text, {[zoneID] = {coordPair,...},...}}
    ['objectives'] = 10, -- table
        --['creatureObjective'] = 1, -- table {{creature(int), text(string), iconFile},...}, If text is nil the default "<Name> slain x/y" is used
        --['objectObjective'] = 2, -- table {{object(int), text(string), iconFile},...}
        --['itemObjective'] = 3, -- table {{item(int), text(string), iconFile},...}
        --['reputationObjective'] = 4, -- table: {faction(int), value(int)}
        --['killCreditObjective'] = 5, -- table: {{{creature(int), ...}, baseCreatureID, baseCreatureText, iconFile}, ...}
        --['spellObjective'] = 6, -- table: {{spell(int), text(string), item(int)},...}
    ['sourceItemId'] = 11, -- int, item provided by quest starter
    ['preQuestGroup'] = 12, -- table: {quest(int)}
    ['preQuestSingle'] = 13, -- table: {quest(int)}
    ['childQuests'] = 14, -- table: {quest(int)}
    ['inGroupWith'] = 15, -- table: {quest(int)}
    ['exclusiveTo'] = 16, -- table: {quest(int)}
    ['zoneOrSort'] = 17, -- int, >0: AreaTable.dbc ID; <0: QuestSort.dbc ID
    ['requiredSkill'] = 18, -- table: {skill(int), value(int)}
    ['requiredMinRep'] = 19, -- table: {faction(int), value(int)}
    ['requiredMaxRep'] = 20, -- table: {faction(int), value(int)}
    ['requiredSourceItems'] = 21, -- table: {item(int), ...} Items that are not an objective but still needed for the quest.
    ['nextQuestInChain'] = 22, -- int: if this quest is active/finished, the current quest is not available anymore
    ['questFlags'] = 23, -- bitmask: see https://github.com/cmangos/issues/wiki/Quest_template#questflags
    ['specialFlags'] = 24, -- bitmask: 1 = Repeatable, 2 = Needs event, 4 = Monthly reset (req. 1). See https://github.com/cmangos/issues/wiki/Quest_template#specialflags
    ['parentQuest'] = 25, -- int, the ID of the parent quest that needs to be active for the current one to be available. See also 'childQuests' (field 14)
    ['reputationReward'] = 26, -- table: {{faction(int), value(number)},...}, a list of reputation rewarded upon quest completion
    ['breadcrumbForQuestId'] = 27, -- int: quest ID for the quest this optional breadcrumb quest leads to
    ['breadcrumbs'] = 28, -- table: {questID(int), ...} quest IDs of the breadcrumbs that lead to this quest
    ['extraObjectives'] = 29, -- table: {{spawnlist, iconFile, text, objectiveIndex (optional), {{dbReferenceType, id}, ...} (optional)},...}, a list of hidden special objectives for a quest. Similar to requiredSourceItems
    ['requiredSpell'] = 30, -- int: quest is only available if character has this spellID
    ['requiredSpecialization'] = 31, -- int: quest is only available if character meets the spec requirements. Use QuestieProfessions.specializationKeys for having a spec, or QuestieProfessions.professionKeys to indicate having the profession with no spec. See QuestieProfessions.lua for more info.
    ['requiredMaxLevel'] = 32, -- int: the maximum level at which the quest is still available
    ['availableUntilCompleted'] = 33, -- int: the current quest is available until this quest is turned in
    ['availableStartingWith'] = 34, -- int: the ID of the quest that needs to be in quest log OR turned in for the current one to be available.
    ['requiredRanks'] = 35, -- table: {{skill(int), value(int)}}. Table of professions and ranks to be checked with OR logic
    ['disabledByQuest'] = 36, -- int: quest that, if in player's quest log, makes current quest unavailable for the duration
}

QuestieDB.questData = [[return {
[7] = {"Kobold Camp Cleanup",{{197}},{{197}},1,2,4294967373,nil,{"Kill 10 Kobold Vermin, then return to Marshal McBride."},nil,{{{6}}},nil,nil,{783},nil,nil,nil,9,nil,nil,nil,nil,nil,8,nil,nil,{{72,250}}},
[12] = {"The People's Militia",{{234}},{{234}},9,12,4294967373,nil,{"Gryan Stoutmantle wants you to kill 15 Defias Trappers and 15 Defias Smugglers then return to him on Sentinel Hill."},nil,{{{504},{95}}},nil,nil,nil,nil,nil,nil,40,nil,nil,nil,nil,13,8,nil,nil,{{72,250}}},
[13] = {"The People's Militia",{{234}},{{234}},9,14,4294967373,nil,{"Gryan Stoutmantle wants you to kill 15 Defias Pillagers and 15 Defias Looters and return to him on Sentinel Hill."},nil,{{{589},{590}}},nil,nil,{12},nil,nil,nil,40,nil,nil,nil,nil,14,8,nil,nil,{{72,250}}},
[14] = {"The People's Militia",{{234}},{{234}},9,17,4294967373,nil,{"Gryan Stoutmantle wants you to kill 15 Defias Highwaymen, 5 Defias Pathstalkers and 5 Defias Knuckledusters then return to him on Sentinel Hill."},nil,{{{122},{121},{449}}},nil,nil,{13},nil,nil,nil,40,nil,nil,nil,nil,nil,8,nil,nil,{{72,350}}},
[15] = {"Investigate Echo Ridge",{{197}},{{197}},1,3,4294967373,nil,{"Kill 10 Kobold Workers, then report back to Marshal McBride."},nil,{{{257}}},nil,nil,{7},nil,nil,nil,9,nil,nil,nil,nil,21,8,nil,nil,{{72,250}}},
[18] = {"Brotherhood of Thieves",{{823}},{{823}},2,4,4294967373,nil,{"Bring 12 Red Burlap Bandanas to Deputy Willem outside the Northshire Abbey."},nil,{nil,nil,{{752}}},nil,nil,{783},nil,nil,nil,9,nil,nil,nil,nil,nil,8,nil,nil,{{72,250}}},
[21] = {"Skirmish at Echo Ridge",{{197}},{{197}},1,5,4294967373,nil,{"Kill 12 Kobold Laborers, then return to Marshal McBride at Northshire Abbey."},nil,{{{80}}},nil,nil,{15},nil,nil,nil,9,nil,nil,nil,nil,nil,8,nil,nil,{{72,250}}},
[783] = {"A Threat Within",{{823}},{{197}},1,1,4294967373,nil,{"Speak with Marshal McBride."},nil,nil,nil,nil,nil,nil,nil,nil,9,nil,nil,nil,nil,7,8,nil,nil,{{72,75}}},
[9001] = {"Skyborne Test",nil,nil,10,12,8589934592,nil,nil,nil,nil,nil,{12,7},nil,nil,nil,{9002},-81},
[9002] = {"Exclusive Partner",nil,nil,10,12,0,nil,nil,nil,nil,nil,nil,nil,nil,nil,{9001},12,nil,nil,nil,nil,nil,nil,nil,nil,nil,nil,{9003}},
[9003] = {"Breadcrumb Quest",nil,nil,10,12,0},
}]]
